package main

import (
	"bytes"
	"math/big"
	"strconv"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

var cfg = &Config{
	Oracle: "0xE01A32fDD09e1c7d981A3894ceF8eC70D8793CcA", FeedDecimals: 8,
	HardBps: 300, SoftBps: 75, ResumeBps: 25, PushBps: 2, HeartbeatSec: 600,
	RefMaxAgeSec: 4500, MarketMaxAgeSec: 90_000,
}

func e18(v float64) *big.Int {
	r, _ := new(big.Rat).SetString(strconv.FormatFloat(v, 'f', -1, 64))
	r.Mul(r, new(big.Rat).SetInt(oneE18))
	return new(big.Int).Quo(r.Num(), r.Denom())
}

func TestSelectorsMatchSignatures(t *testing.T) {
	if !bytes.Equal(latestRoundDataSelector, crypto.Keccak256([]byte("latestRoundData()"))[:4]) {
		t.Fatal("latestRoundData selector")
	}
	if !bytes.Equal(statusSelector, crypto.Keccak256([]byte("status(address)"))[:4]) {
		t.Fatal("status selector")
	}
	if !bytes.Equal(multicallAbi.Methods["aggregate3"].ID, common.FromHex("0x82ad56cb")) {
		t.Fatal("aggregate3 selector")
	}
}

func TestDecidePegged(t *testing.T) {
	now := int64(1_000_000)
	cases := []struct {
		name string
		obs  Observation
		halt bool
	}{
		{"at peg", Observation{Pegged: true, Feed: e18(0.9999), Api: e18(1.0001)}, false},
		{"offchain hard depeg halts alone", Observation{Pegged: true, Feed: e18(0.9999), Api: e18(0.93)}, true},
		{"chainlink hard depeg halts alone", Observation{Pegged: true, Feed: e18(0.96), Api: e18(0.99)}, true},
		{"one soft source does not halt", Observation{Pegged: true, Feed: e18(1), Api: e18(0.991)}, false},
		{"both soft sources halt", Observation{Pegged: true, Feed: e18(0.992), Api: e18(0.991)}, true},
		{"depeg above peg halts", Observation{Pegged: true, Feed: e18(1), Api: e18(1.04)}, true},
		{"halted stays halted outside resume band", Observation{Pegged: true, Feed: e18(0.995), Api: e18(0.996), Halted: true}, true},
		{"halted resumes inside resume band", Observation{Pegged: true, Feed: e18(0.999), Api: e18(0.9985), Halted: true}, false},
		{"halted stays halted with no data", Observation{Pegged: true, Halted: true}, true},
		{"no data stays open", Observation{Pegged: true}, false},
	}
	for _, c := range cases {
		d := Decide(cfg, c.obs, now)
		if !d.Known || d.Halt != c.halt {
			t.Errorf("%s: known=%v halt=%v want %v (%s)", c.name, d.Known, d.Halt, c.halt, d.Reason)
		}
	}
}

func TestDecideFxUsesReferenceRate(t *testing.T) {
	eur := e18(1.12)
	cases := []struct {
		name string
		obs  Observation
		halt bool
	}{
		{"EURC at EUR rate", Observation{Ref: eur, Feed: e18(1.1195), Api: e18(1.1203)}, false},
		{"EURC below EUR by 5 percent halts", Observation{Ref: eur, Feed: e18(1.119), Api: e18(1.064)}, true},
		{"EURC at 1 dollar is a depeg, not peg", Observation{Ref: eur, Api: e18(1.0)}, true},
		{"BRZ at BRL rate with api only", Observation{Ref: e18(0.18), Api: e18(0.1801)}, false},
	}
	for _, c := range cases {
		d := Decide(cfg, c.obs, 0)
		if !d.Known || d.Halt != c.halt {
			t.Errorf("%s: known=%v halt=%v want %v (%s)", c.name, d.Known, d.Halt, c.halt, d.Reason)
		}
	}
	d := Decide(cfg, Observation{Ref: e18(0.18)}, 0)
	if !d.Known || d.PriceE18.Cmp(e18(0.18)) != 0 {
		t.Fatalf("without market data the reference rate is reported: %v", d.PriceE18)
	}
}

func TestDecideUnknownReferenceIsNotReported(t *testing.T) {
	d := Decide(cfg, Observation{Api: e18(1.12), Halted: true}, 0)
	if d.Known || !d.Halt || d.Push {
		t.Fatalf("stale fx rate must keep onchain state untouched: %+v", d)
	}
}

func TestDecidePrefersOffchainPrice(t *testing.T) {
	d := Decide(cfg, Observation{Pegged: true, Feed: e18(0.9999), Api: e18(0.93)}, 0)
	if d.PriceE18.Cmp(e18(0.93)) != 0 {
		t.Fatalf("price %s", d.PriceE18)
	}
}

func TestPushRules(t *testing.T) {
	now := int64(10_000)
	eur := e18(1.12)
	cases := []struct {
		name string
		obs  Observation
		push bool
	}{
		{"fx move under threshold", Observation{Ref: eur, Api: e18(1.12011), OnchainPrice: eur, OnchainAt: now - 60}, false},
		{"fx move over threshold", Observation{Ref: eur, Api: e18(1.1203), OnchainPrice: eur, OnchainAt: now - 60}, true},
		{"fx heartbeat", Observation{Ref: eur, Api: eur, OnchainPrice: eur, OnchainAt: now - 600}, true},
		{"fx never reported", Observation{Ref: eur, Api: eur}, true},
		{"pegged quiet coin never pushes", Observation{Pegged: true, Api: e18(0.9995), OnchainAt: now - 99_999}, false},
		{"pegged halt flips", Observation{Pegged: true, Api: e18(0.9), OnchainPrice: e18(1), OnchainAt: now}, true},
		{"halted coin price moves", Observation{Pegged: true, Api: e18(0.85), Halted: true, OnchainPrice: e18(0.9), OnchainAt: now}, true},
		{"halted coin steady", Observation{Pegged: true, Api: e18(0.9), Halted: true, OnchainPrice: e18(0.9), OnchainAt: now - 10}, false},
		{"halted coin heartbeat", Observation{Pegged: true, Api: e18(0.9), Halted: true, OnchainPrice: e18(0.9), OnchainAt: now - 600}, true},
		{"resume pushes", Observation{Pegged: true, Api: e18(1), Feed: e18(1), Halted: true, OnchainPrice: e18(0.9), OnchainAt: now}, true},
	}
	for _, c := range cases {
		if got := Decide(cfg, c.obs, now); got.Push != c.push {
			t.Errorf("%s: push=%v want %v (%s)", c.name, got.Push, c.push, got.Reason)
		}
	}
}

func TestMedian(t *testing.T) {
	if Median([]*big.Int{big.NewInt(0), nil}) != nil {
		t.Fatal("no positive values")
	}
	if Median([]*big.Int{big.NewInt(7), big.NewInt(0)}).Int64() != 7 {
		t.Fatal("zero is missing, not a price")
	}
	if Median([]*big.Int{big.NewInt(10), big.NewInt(20)}).Int64() != 15 {
		t.Fatal("two sources average")
	}
	if Median([]*big.Int{big.NewInt(30), big.NewInt(10), big.NewInt(20)}).Int64() != 20 {
		t.Fatal("odd count")
	}
}

func TestParsePrice(t *testing.T) {
	cases := []struct {
		body string
		path string
		want *big.Int
	}{
		{`{"ethena-usde":{"usd":0.9993}}`, "ethena-usde.usd", e18(0.9993)},
		{`{"usd-coin":{"usd":1}}`, "usd-coin.usd", oneE18},
		{`{"idrx":{"usd":5.52e-05}}`, "idrx.usd", big.NewInt(55_200_000_000_000)},
		{`{"coins":{"base:0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22":{"price":5.520208569341356e-05}}}`,
			"coins.base:0x18Bc5bcC660cf2B9cE3cd51a404aFe1a0cBD3C22.price", big.NewInt(55_202_085_693_413)},
		{`{"USDe":0.93}`, "USDe", e18(0.93)},
		{`{"price":"0.18"}`, "price", e18(0.18)},
	}
	for _, c := range cases {
		got, err := ParsePriceE18([]byte(c.body), c.path)
		if err != nil || got.Cmp(c.want) != 0 {
			t.Errorf("%s %s: got %v err %v want %v", c.body, c.path, got, err, c.want)
		}
	}
	for _, bad := range []struct{ body, path string }{{`{"a":1}`, "b"}, {`{"a":{"b":true}}`, "a.b"}, {`nope`, "a"}, {`{"a":0}`, "a"}, {`{"a":-1}`, "a"}} {
		if _, err := ParsePriceE18([]byte(bad.body), bad.path); err == nil {
			t.Errorf("expected error for %s %s", bad.body, bad.path)
		}
	}
}

func TestParseApiMissingIsZero(t *testing.T) {
	a := ParseApi([]byte(`{"USDC":1,"USDe":0.93}`), []string{"USDC", "DAI", "USDe", ""})
	if a.Get(0).Cmp(oneE18) != 0 || a.Get(1).Sign() != 0 || a.Get(2).Cmp(e18(0.93)) != 0 || a.Get(3).Sign() != 0 || a.Get(8).Sign() != 0 {
		t.Fatalf("parse api: %v %v %v %v", a.Get(0), a.Get(1), a.Get(2), a.Get(3))
	}
}

func TestEncodeReportMatchesCast(t *testing.T) {
	want := common.FromHex("0x000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000140000000000000000000000000000000000000000000000000000000006aecbde00000000000000000000000000000000000000000000000000000000000000002000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda029130000000000000000000000005d3a1ff2b6bab83b63cd9ad0787074081a52ef3400000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000de02bc471dad0000000000000000000000000000000000000000000000000000ce80612991d0000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001")
	got, err := EncodeReport(
		[]common.Address{
			common.HexToAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
			common.HexToAddress("0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34"),
		},
		[]*big.Int{big.NewInt(999_847_240_000_000_000), big.NewInt(930_000_000_000_000_000)},
		[]bool{false, true},
		1_793_900_000,
	)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("report encoding mismatch: %x", got)
	}
}

func TestAggregate3MatchesCast(t *testing.T) {
	want := common.FromHex("0x82ad56cb0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000100000000000000000000000000e01a32fdd09e1c7d981a3894cef8ec70d8793cca000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000024645b8b1b000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913000000000000000000000000000000000000000000000000000000000000000000000000000000007e860098f58bbfc8648a4311b374b1d669a2bc6b000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000004feaf968c00000000000000000000000000000000000000000000000000000000")
	c := &Config{Oracle: cfg.Oracle, Tokens: []TokenConfig{{
		Symbol: "USDC", Address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", MarketFeed: "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B",
	}}}
	plan := PlanReads(c)
	if plan.Status[0] != 0 || plan.Ref[0] != -1 || plan.Market[0] != 1 {
		t.Fatalf("plan indexes %+v", plan)
	}
	got, err := EncodeAggregate3(plan.Calls)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("aggregate3 encoding mismatch: %x", got)
	}
}

func TestAggregate3RoundTrip(t *testing.T) {
	status, _ := statusOut.Pack(true, uint64(1_700_000_000), e18(0.93))
	round, _ := roundOut.Pack(big.NewInt(5), big.NewInt(111_797_000), big.NewInt(1), big.NewInt(9_000), big.NewInt(5))
	encoded, err := multicallAbi.Methods["aggregate3"].Outputs.Pack([]Result3{{true, status}, {true, round}, {false, nil}})
	if err != nil {
		t.Fatal(err)
	}
	res, err := DecodeAggregate3(encoded)
	if err != nil || len(res) != 3 {
		t.Fatalf("decode: %v %d", err, len(res))
	}
	s, err := DecodeStatus(res[0].ReturnData)
	if err != nil || !s.Halted || s.ObservedAt != 1_700_000_000 || s.PriceE18.Cmp(e18(0.93)) != 0 {
		t.Fatalf("status %+v %v", s, err)
	}
	if p := FreshFeed(res[1], 8, 4500, 10_000); p == nil || p.Cmp(e18(1.11797)) != 0 {
		t.Fatalf("fresh feed %v", p)
	}
	if FreshFeed(res[1], 8, 500, 10_000) != nil {
		t.Fatal("stale feed must be dropped")
	}
	if FreshFeed(res[2], 8, 4500, 10_000) != nil {
		t.Fatal("failed call must be dropped")
	}
}

func TestValidate(t *testing.T) {
	good := *cfg
	good.ApiUrls = []string{"a", "b"}
	good.Tokens = []TokenConfig{{Symbol: "USDC", ApiPaths: []string{"x", "y"}}}
	if err := good.Validate(); err != nil {
		t.Fatal(err)
	}
	bad := good
	bad.Tokens = []TokenConfig{{Symbol: "USDC", ApiPaths: []string{"x"}}}
	if bad.Validate() == nil {
		t.Fatal("api path count must match api urls")
	}
	bad = good
	bad.ResumeBps = 80
	if bad.Validate() == nil {
		t.Fatal("resume band must sit inside soft band")
	}
}
