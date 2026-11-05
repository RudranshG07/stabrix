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

type TokenConfig struct {
	Symbol   string `json:"symbol"`
	Address  string `json:"address"`
	Feed     string `json:"feed"`
	ApiUrl   string `json:"apiUrl"`
	JsonPath string `json:"jsonPath"`
}

type Config struct {
	Schedule      string        `json:"schedule"`
	ChainName     string        `json:"chainName"`
	Sentinel      string        `json:"sentinel"`
	GasLimit      uint64        `json:"gasLimit"`
	HardBps       int64         `json:"hardBps"`
	SoftBps       int64         `json:"softBps"`
	ResumeBps     int64         `json:"resumeBps"`
	MaxFeedAgeSec int64         `json:"maxFeedAgeSec"`
	Tokens        []TokenConfig `json:"tokens"`
}

type Observation struct {
	FeedE8        *big.Int
	FeedUpdatedAt int64
	ApiE8         *big.Int
	Halted        bool
}

type Decision struct {
	Halt    bool
	PriceE8 *big.Int
	Reason  string
}

var (
	oneE8     = big.NewInt(100_000_000)
	bpsScale  = big.NewInt(10_000)
	addrArr   = mustType("address[]")
	int256Arr = mustType("int256[]")
	boolArr   = mustType("bool[]")
	uint64T   = mustType("uint64")
	roundOut  = abi.Arguments{{Type: mustType("uint80")}, {Type: mustType("int256")}, {Type: mustType("uint256")}, {Type: mustType("uint256")}, {Type: mustType("uint80")}}
	statusOut = abi.Arguments{{Type: mustType("bool")}, {Type: mustType("int192")}, {Type: mustType("uint64")}}
	reportIn  = abi.Arguments{{Type: addrArr}, {Type: int256Arr}, {Type: boolArr}, {Type: uint64T}}

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

func deviationBps(priceE8 *big.Int) int64 {
	d := new(big.Int).Sub(priceE8, oneE8)
	d.Abs(d)
	d.Mul(d, bpsScale)
	d.Quo(d, oneE8)
	return d.Int64()
}

func Decide(cfg *Config, o Observation, now int64) Decision {
	feedFresh := o.FeedE8 != nil && o.FeedE8.Sign() > 0 && now-o.FeedUpdatedAt <= cfg.MaxFeedAgeSec
	apiOk := o.ApiE8 != nil && o.ApiE8.Sign() > 0

	price := oneE8
	switch {
	case apiOk:
		price = o.ApiE8
	case feedFresh:
		price = o.FeedE8
	}

	var feedDev, apiDev int64
	if feedFresh {
		feedDev = deviationBps(o.FeedE8)
	}
	if apiOk {
		apiDev = deviationBps(o.ApiE8)
	}

	switch {
	case apiOk && apiDev >= cfg.HardBps:
		return Decision{true, price, fmt.Sprintf("offchain %dbps >= hard %dbps", apiDev, cfg.HardBps)}
	case feedFresh && feedDev >= cfg.HardBps:
		return Decision{true, price, fmt.Sprintf("chainlink %dbps >= hard %dbps", feedDev, cfg.HardBps)}
	case apiOk && feedFresh && apiDev >= cfg.SoftBps && feedDev >= cfg.SoftBps:
		return Decision{true, price, fmt.Sprintf("both sources >= soft %dbps", cfg.SoftBps)}
	}

	if o.Halted {
		calm := (!apiOk || apiDev <= cfg.ResumeBps) && (!feedFresh || feedDev <= cfg.ResumeBps) && (apiOk || feedFresh)
		if !calm {
			return Decision{true, price, "holding halt until both sources are within resume band"}
		}
		return Decision{false, price, "back within resume band"}
	}
	return Decision{false, price, "within peg"}
}

func ParsePriceE8(body []byte, path string) (*big.Int, error) {
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
	if !ok {
		return nil, fmt.Errorf("path %q: bad number %q", path, text)
	}
	r.Mul(r, new(big.Rat).SetInt(oneE8))
	return new(big.Int).Quo(r.Num(), r.Denom()), nil
}

func DecodeLatestRound(data []byte) (*big.Int, int64, error) {
	out, err := roundOut.Unpack(data)
	if err != nil {
		return nil, 0, err
	}
	return out[1].(*big.Int), out[3].(*big.Int).Int64(), nil
}

func DecodeStatus(data []byte) (bool, error) {
	out, err := statusOut.Unpack(data)
	if err != nil {
		return false, err
	}
	return out[0].(bool), nil
}

func StatusCall(token common.Address) []byte {
	return append(append([]byte{}, statusSelector...), common.LeftPadBytes(token.Bytes(), 32)...)
}

func EncodeReport(tokens []common.Address, prices []*big.Int, halted []bool, observedAt uint64) ([]byte, error) {
	return reportIn.Pack(tokens, prices, halted, observedAt)
}
