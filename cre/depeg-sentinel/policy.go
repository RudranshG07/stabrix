package main

import (
	"encoding/json"
	"fmt"
	"math/big"
	"strconv"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

const MaxTokens = 9

// ExtraChainSelectors covers chains the pinned EVM capability cannot name yet. Values from
// github.com/smartcontractkit/chain-selectors selectors.yml.
var ExtraChainSelectors = map[string]uint64{
	"ethereum-mainnet-base-1": 15971525489660198786,
}

func ChainSelector(name string, lookup func(string) (uint64, error)) (uint64, error) {
	selector, err := lookup(name)
	if err == nil {
		return selector, nil
	}
	if s, ok := ExtraChainSelectors[name]; ok {
		return s, nil
	}
	return 0, err
}

type TokenConfig struct {
	Symbol     string   `json:"symbol"`
	Address    string   `json:"address"`
	RefFeed    string   `json:"refFeed"`
	MarketFeed string   `json:"marketFeed"`
	ApiPaths   []string `json:"apiPaths"`
}

type Config struct {
	Schedule        string        `json:"schedule"`
	ChainName       string        `json:"chainName"`
	Oracle          string        `json:"oracle"`
	Multicall       string        `json:"multicall"`
	GasLimit        uint64        `json:"gasLimit"`
	FeedDecimals    int64         `json:"feedDecimals"`
	HardBps         int64         `json:"hardBps"`
	SoftBps         int64         `json:"softBps"`
	ResumeBps       int64         `json:"resumeBps"`
	PushBps         int64         `json:"pushBps"`
	HeartbeatSec    int64         `json:"heartbeatSec"`
	RefMaxAgeSec    int64         `json:"refMaxAgeSec"`
	MarketMaxAgeSec int64         `json:"marketMaxAgeSec"`
	ApiUrls         []string      `json:"apiUrls"`
	Tokens          []TokenConfig `json:"tokens"`
}

func (c *Config) Validate() error {
	if len(c.Tokens) == 0 || len(c.Tokens) > MaxTokens {
		return fmt.Errorf("need 1 to %d tokens, got %d", MaxTokens, len(c.Tokens))
	}
	if c.FeedDecimals < 0 || c.FeedDecimals > 18 {
		return fmt.Errorf("feedDecimals %d out of range", c.FeedDecimals)
	}
	if c.SoftBps <= 0 || c.HardBps <= c.SoftBps || c.ResumeBps >= c.SoftBps || c.PushBps <= 0 || c.HeartbeatSec <= 0 {
		return fmt.Errorf("bad thresholds")
	}
	for _, t := range c.Tokens {
		if len(t.ApiPaths) != len(c.ApiUrls) {
			return fmt.Errorf("%s: %d api paths for %d api urls", t.Symbol, len(t.ApiPaths), len(c.ApiUrls))
		}
	}
	return nil
}

type Observation struct {
	Pegged       bool
	Ref          *big.Int
	Feed         *big.Int
	Api          []*big.Int
	ApiExpected  int
	Halted       bool
	OnchainPrice *big.Int
	OnchainAt    int64
}

type Decision struct {
	Known    bool
	Halt     bool
	PriceE18 *big.Int
	Push     bool
	Reason   string
}

var (
	oneE18   = new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)
	bpsScale = big.NewInt(10_000)
)

func deviationBps(price, ref *big.Int) int64 {
	d := new(big.Int).Sub(price, ref)
	d.Abs(d)
	d.Mul(d, bpsScale)
	d.Quo(d, ref)
	if !d.IsInt64() {
		return 1 << 62
	}
	return d.Int64()
}

func positive(v *big.Int) bool { return v != nil && v.Sign() > 0 }

// Decide halts on offchain data only when every API configured for the coin answered and even the least alarming
// quote is past the limit, so one stale or missing API cannot halt a healthy coin; the Chainlink feed can halt alone.
// A healthy coin is reported at the quote closest to its reference, so one lagging API cannot misprice ranges, and a
// halted coin at the lowest market price, which is the safe side for backstop makers. A halted coin with no market
// data is not reported, so its onchain price ages out instead of being refreshed with the reference rate.
func Decide(cfg *Config, o Observation, now int64) Decision {
	ref := o.Ref
	if o.Pegged {
		ref = oneE18
	}
	if !positive(ref) {
		return Decision{Halt: o.Halted, Reason: "no reference rate"}
	}
	var quotes []*big.Int
	for _, q := range o.Api {
		if positive(q) {
			quotes = append(quotes, q)
		}
	}
	feedOk, apiOk := positive(o.Feed), len(quotes) > 0
	apiAll := apiOk && len(quotes) >= o.ApiExpected
	if !feedOk && !apiOk && o.Halted {
		return Decision{Halt: true, Reason: "no market data while halted"}
	}

	var feedDev, apiDev int64
	if feedOk {
		feedDev = deviationBps(o.Feed, ref)
	}
	if apiOk {
		apiDev = deviationBps(quotes[0], ref)
		for _, q := range quotes[1:] {
			if dev := deviationBps(q, ref); dev < apiDev {
				apiDev = dev
			}
		}
	}

	d := Decision{Known: true}
	switch {
	case apiAll && apiDev >= cfg.HardBps:
		d.Halt, d.Reason = true, fmt.Sprintf("offchain %dbps >= hard %dbps", apiDev, cfg.HardBps)
	case feedOk && feedDev >= cfg.HardBps:
		d.Halt, d.Reason = true, fmt.Sprintf("chainlink %dbps >= hard %dbps", feedDev, cfg.HardBps)
	case apiAll && feedOk && apiDev >= cfg.SoftBps && feedDev >= cfg.SoftBps:
		d.Halt, d.Reason = true, fmt.Sprintf("both sources >= soft %dbps", cfg.SoftBps)
	case o.Halted:
		calm := (!apiOk || apiDev <= cfg.ResumeBps) && (!feedOk || feedDev <= cfg.ResumeBps)
		d.Halt = !calm
		if calm {
			d.Reason = "back within resume band"
		} else {
			d.Reason = "holding halt until sources are within resume band"
		}
	default:
		d.Reason = "within peg"
	}

	switch {
	case d.Halt:
		market := append([]*big.Int{}, quotes...)
		if feedOk {
			market = append(market, o.Feed)
		}
		d.PriceE18 = market[0]
		for _, m := range market[1:] {
			if m.Cmp(d.PriceE18) < 0 {
				d.PriceE18 = m
			}
		}
	case apiOk:
		d.PriceE18 = quotes[0]
		for _, q := range quotes[1:] {
			if deviationBps(q, ref) < deviationBps(d.PriceE18, ref) {
				d.PriceE18 = q
			}
		}
	case feedOk:
		d.PriceE18 = o.Feed
	default:
		d.PriceE18 = ref
	}

	d.Push = d.Halt != o.Halted
	if !d.Push && (!o.Pegged || d.Halt) {
		d.Push = !positive(o.OnchainPrice) ||
			deviationBps(d.PriceE18, o.OnchainPrice) >= cfg.PushBps ||
			now-o.OnchainAt >= cfg.HeartbeatSec
	}
	return d
}

func ScaleFeed(answer *big.Int, decimals int64) *big.Int {
	return new(big.Int).Mul(answer, new(big.Int).Exp(big.NewInt(10), big.NewInt(18-decimals), nil))
}

func ParsePriceE18(body []byte, path string) (*big.Int, error) {
	var root any
	if err := json.Unmarshal(body, &root); err != nil {
		return nil, fmt.Errorf("invalid json: %w", err)
	}
	node := root
	for _, key := range strings.Split(path, ".") {
		obj, ok := node.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("path %q: %q is not an object", path, key)
		}
		if node, ok = obj[key]; !ok {
			return nil, fmt.Errorf("path %q: missing %q", path, key)
		}
	}
	var text string
	switch v := node.(type) {
	case float64:
		text = strconv.FormatFloat(v, 'f', -1, 64)
	case string:
		text = v
	default:
		return nil, fmt.Errorf("path %q: not a number", path)
	}
	r, ok := new(big.Rat).SetString(text)
	if !ok || r.Sign() <= 0 {
		return nil, fmt.Errorf("path %q: bad price %q", path, text)
	}
	r.Mul(r, new(big.Rat).SetInt(oneE18))
	return new(big.Int).Quo(r.Num(), r.Denom()), nil
}

// ApiPrices carries one API's prices for up to MaxTokens coins. Mask marks which coins the API returned and must be
// identical across nodes, so a coin missing on some nodes never mixes zeros into the median.
type ApiPrices struct {
	Mask uint64   `consensus_aggregation:"identical"`
	P0   *big.Int `consensus_aggregation:"median"`
	P1   *big.Int `consensus_aggregation:"median"`
	P2   *big.Int `consensus_aggregation:"median"`
	P3   *big.Int `consensus_aggregation:"median"`
	P4   *big.Int `consensus_aggregation:"median"`
	P5   *big.Int `consensus_aggregation:"median"`
	P6   *big.Int `consensus_aggregation:"median"`
	P7   *big.Int `consensus_aggregation:"median"`
	P8   *big.Int `consensus_aggregation:"median"`
}

func (a *ApiPrices) slots() [MaxTokens]**big.Int {
	return [MaxTokens]**big.Int{&a.P0, &a.P1, &a.P2, &a.P3, &a.P4, &a.P5, &a.P6, &a.P7, &a.P8}
}

func NewApiPrices() ApiPrices {
	var a ApiPrices
	for _, s := range a.slots() {
		*s = big.NewInt(0)
	}
	return a
}

func (a *ApiPrices) Set(k int, v *big.Int) { *a.slots()[k] = v }

func (a *ApiPrices) Get(k int) *big.Int {
	if a.Mask&(1<<uint(k)) == 0 {
		return nil
	}
	return *a.slots()[k]
}

func ParseApi(body []byte, paths []string) ApiPrices {
	a := NewApiPrices()
	for k, p := range paths {
		if p == "" {
			continue
		}
		if v, err := ParsePriceE18(body, p); err == nil {
			a.Set(k, v)
			a.Mask |= 1 << uint(k)
		}
	}
	return a
}

var (
	multicallAbi = mustAbi(`[{"name":"aggregate3","type":"function","stateMutability":"payable",
		"inputs":[{"name":"calls","type":"tuple[]","components":[{"name":"target","type":"address"},{"name":"allowFailure","type":"bool"},{"name":"callData","type":"bytes"}]}],
		"outputs":[{"name":"returnData","type":"tuple[]","components":[{"name":"success","type":"bool"},{"name":"returnData","type":"bytes"}]}]}]`)
	roundOut  = abi.Arguments{{Type: mustType("uint80")}, {Type: mustType("int256")}, {Type: mustType("uint256")}, {Type: mustType("uint256")}, {Type: mustType("uint80")}}
	statusOut = abi.Arguments{{Type: mustType("bool")}, {Type: mustType("uint64")}, {Type: mustType("uint128")}}
	reportIn  = abi.Arguments{{Type: mustType("address[]")}, {Type: mustType("uint256[]")}, {Type: mustType("bool[]")}, {Type: mustType("uint64")}}

	latestRoundDataSelector = common.FromHex("0xfeaf968c")
	statusSelector          = common.FromHex("0x645b8b1b")
)

func mustType(t string) abi.Type {
	ty, err := abi.NewType(t, "", nil)
	if err != nil {
		panic(err)
	}
	return ty
}

func mustAbi(s string) abi.ABI {
	a, err := abi.JSON(strings.NewReader(s))
	if err != nil {
		panic(err)
	}
	return a
}

type Call3 struct {
	Target       common.Address
	AllowFailure bool
	CallData     []byte
}

type Result3 struct {
	Success    bool
	ReturnData []byte
}

type CallPlan struct {
	Calls  []Call3
	Status []int
	Ref    []int
	Market []int
}

func PlanReads(cfg *Config) CallPlan {
	oracle := common.HexToAddress(cfg.Oracle)
	n := len(cfg.Tokens)
	p := CallPlan{Status: make([]int, n), Ref: make([]int, n), Market: make([]int, n)}
	add := func(to common.Address, allowFailure bool, data []byte) int {
		p.Calls = append(p.Calls, Call3{Target: to, AllowFailure: allowFailure, CallData: data})
		return len(p.Calls) - 1
	}
	for k, t := range cfg.Tokens {
		p.Status[k] = add(oracle, false, StatusCall(common.HexToAddress(t.Address)))
		p.Ref[k], p.Market[k] = -1, -1
		if t.RefFeed != "" {
			p.Ref[k] = add(common.HexToAddress(t.RefFeed), true, latestRoundDataSelector)
		}
		if t.MarketFeed != "" {
			p.Market[k] = add(common.HexToAddress(t.MarketFeed), true, latestRoundDataSelector)
		}
	}
	return p
}

func EncodeAggregate3(calls []Call3) ([]byte, error) {
	return multicallAbi.Pack("aggregate3", calls)
}

func DecodeAggregate3(data []byte) ([]Result3, error) {
	var out []Result3
	if err := multicallAbi.UnpackIntoInterface(&out, "aggregate3", data); err != nil {
		return nil, err
	}
	return out, nil
}

func DecodeLatestRound(data []byte) (*big.Int, int64, error) {
	out, err := roundOut.Unpack(data)
	if err != nil {
		return nil, 0, err
	}
	return out[1].(*big.Int), out[3].(*big.Int).Int64(), nil
}

type OnchainStatus struct {
	Halted     bool
	ObservedAt int64
	PriceE18   *big.Int
}

func DecodeStatus(data []byte) (OnchainStatus, error) {
	out, err := statusOut.Unpack(data)
	if err != nil {
		return OnchainStatus{}, err
	}
	return OnchainStatus{Halted: out[0].(bool), ObservedAt: int64(out[1].(uint64)), PriceE18: out[2].(*big.Int)}, nil
}

func FreshFeed(r Result3, decimals, maxAge, now int64) *big.Int {
	if !r.Success {
		return nil
	}
	answer, updatedAt, err := DecodeLatestRound(r.ReturnData)
	if err != nil || answer.Sign() <= 0 || updatedAt > now || now-updatedAt > maxAge {
		return nil
	}
	return ScaleFeed(answer, decimals)
}

func StatusCall(token common.Address) []byte {
	return append(append([]byte{}, statusSelector...), common.LeftPadBytes(token.Bytes(), 32)...)
}

func EncodeReport(tokens []common.Address, prices []*big.Int, halted []bool, observedAt uint64) ([]byte, error) {
	return reportIn.Pack(tokens, prices, halted, observedAt)
}
