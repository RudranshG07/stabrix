package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
)

func loadConfig(t *testing.T, path string) *Config {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var c Config
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	if err := c.Validate(); err != nil {
		t.Fatalf("%s: %v", path, err)
	}
	return &c
}

func rpc(t *testing.T, url, method string, params ...any) json.RawMessage {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
	resp, err := http.Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out struct {
		Result json.RawMessage `json:"result"`
		Error  *struct{ Message string } `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Error != nil {
		t.Fatalf("%s: %s", method, out.Error.Message)
	}
	return out.Result
}

func TestConfigsAreValid(t *testing.T) {
	for _, p := range []string{"config.fork.json", "config.production.json"} {
		c := loadConfig(t, p)
		if len(c.Tokens) != 8 {
			t.Fatalf("%s: %d tokens", p, len(c.Tokens))
		}
	}
}

func TestForkReadsAndDecisions(t *testing.T) {
	url := os.Getenv("STABRIX_FORK_RPC")
	if url == "" {
		t.Skip("set STABRIX_FORK_RPC to run against a fork")
	}
	cfg := loadConfig(t, "config.fork.json")
	plan := PlanReads(cfg)
	data, err := EncodeAggregate3(plan.Calls)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) > 5*1024 {
		t.Fatalf("read payload %d bytes exceeds the CRE 5 KB limit", len(data))
	}
	var hexOut string
	call := map[string]string{"to": cfg.Multicall, "data": hexutil.Encode(data)}
	if err := json.Unmarshal(rpc(t, url, "eth_call", call, "latest"), &hexOut); err != nil {
		t.Fatal(err)
	}
	results, err := DecodeAggregate3(common.FromHex(hexOut))
	if err != nil || len(results) != len(plan.Calls) {
		t.Fatalf("decode: %v %d", err, len(results))
	}
	var block struct{ Timestamp string }
	_ = json.Unmarshal(rpc(t, url, "eth_getBlockByNumber", "latest", false), &block)
	now, _ := strconv.ParseInt(strings.TrimPrefix(block.Timestamp, "0x"), 16, 64)

	api := NewApiPrices()
	if resp, err := http.Get(cfg.ApiUrls[0]); err == nil {
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		paths := make([]string, len(cfg.Tokens))
		for k, tk := range cfg.Tokens {
			paths[k] = tk.ApiPaths[0]
		}
		api = ParseApi(body, paths)
	}

	for k, tk := range cfg.Tokens {
		status, err := DecodeStatus(results[plan.Status[k]].ReturnData)
		if err != nil {
			t.Fatalf("%s status: %v", tk.Symbol, err)
		}
		obs := Observation{Pegged: tk.RefFeed == "", Halted: status.Halted, OnchainPrice: status.PriceE18, OnchainAt: status.ObservedAt}
		if plan.Ref[k] >= 0 {
			if obs.Ref = FreshFeed(results[plan.Ref[k]], cfg.FeedDecimals, cfg.RefMaxAgeSec, now); obs.Ref == nil {
				t.Fatalf("%s reference feed is stale or failed", tk.Symbol)
			}
		}
		if plan.Market[k] >= 0 {
			obs.Feed = FreshFeed(results[plan.Market[k]], cfg.FeedDecimals, cfg.MarketMaxAgeSec, now)
		}
		obs.Api = Median([]*big.Int{api.Get(k)})
		d := Decide(cfg, obs, now)
		if !d.Known {
			t.Fatalf("%s: unknown decision", tk.Symbol)
		}
		t.Logf("%-5s ref=%v feed=%v api=%v onchainHalted=%v -> halt=%v push=%v (%s)", tk.Symbol, obs.Ref, obs.Feed, obs.Api, obs.Halted, d.Halt, d.Push, d.Reason)
		if want := os.Getenv("STABRIX_EXPECT_HALTED"); want != "" {
			if d.Halt != strings.Contains(","+want+",", ","+tk.Symbol+",") {
				t.Errorf("%s: halt=%v, expected halted set %s", tk.Symbol, d.Halt, want)
			}
		}
	}
}

func TestLiveProductionApis(t *testing.T) {
	if os.Getenv("STABRIX_LIVE_APIS") == "" {
		t.Skip("set STABRIX_LIVE_APIS=1 to query CoinGecko and DefiLlama")
	}
	cfg := loadConfig(t, "config.production.json")
	refs := map[string]float64{"EURC": 1.12, "BRZ": 0.18, "IDRX": 0.0000553}
	for a, url := range cfg.ApiUrls {
		resp, err := http.Get(url)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("%s: status %d", url, resp.StatusCode)
		}
		paths := make([]string, len(cfg.Tokens))
		for k, tk := range cfg.Tokens {
			paths[k] = tk.ApiPaths[a]
		}
		got := ParseApi(body, paths)
		for k, tk := range cfg.Tokens {
			p := got.Get(k)
			if p.Sign() <= 0 {
				t.Errorf("api %d: no price for %s", a, tk.Symbol)
				continue
			}
			ref := 1.0
			if r, ok := refs[tk.Symbol]; ok {
				ref = r
			}
			f, _ := new(big.Rat).SetFrac(p, oneE18).Float64()
			if f < ref*0.9 || f > ref*1.1 {
				t.Errorf("api %d: %s price %v far from %v", a, tk.Symbol, f, ref)
			}
			t.Logf("api %d %-5s %s", a, tk.Symbol, fmt.Sprintf("%.8f", f))
		}
	}
}
