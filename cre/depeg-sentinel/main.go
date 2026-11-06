//go:build wasip1

package main

import (
	"fmt"
	"log/slog"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/blockchain/evm"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/networking/http"
	"github.com/smartcontractkit/cre-sdk-go/capabilities/scheduler/cron"
	"github.com/smartcontractkit/cre-sdk-go/cre"
	"github.com/smartcontractkit/cre-sdk-go/cre/wasm"
)

type Result struct {
	Pushed []string `json:"pushed"`
	TxHash string   `json:"txHash,omitempty"`
}

func InitWorkflow(config *Config, logger *slog.Logger, _ cre.SecretsProvider) (cre.Workflow[*Config], error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	return cre.Workflow[*Config]{
		cre.Handler(cron.Trigger(&cron.Config{Schedule: config.Schedule}), onTick),
	}, nil
}

func fetchApi(url string, paths []string) func(*Config, *slog.Logger, *http.SendRequester) (ApiPrices, error) {
	return func(_ *Config, _ *slog.Logger, r *http.SendRequester) (ApiPrices, error) {
		resp, err := r.SendRequest(&http.Request{Url: url, Method: "GET"}).Await()
		if err != nil {
			return NewApiPrices(), err
		}
		if resp.StatusCode != 200 {
			return NewApiPrices(), fmt.Errorf("%s status %d", url, resp.StatusCode)
		}
		return ParseApi(resp.Body, paths), nil
	}
}

func onTick(config *Config, runtime cre.Runtime, _ *cron.Payload) (*Result, error) {
	logger := runtime.Logger()
	selector, err := evm.ChainSelectorFromName(config.ChainName)
	if err != nil {
		return nil, err
	}
	chain := &evm.Client{ChainSelector: selector}
	now := runtime.Now().Unix()
	n := len(config.Tokens)

	plan := PlanReads(config)
	data, err := EncodeAggregate3(plan.Calls)
	if err != nil {
		return nil, err
	}
	reply, err := chain.CallContract(runtime, &evm.CallContractRequest{
		Call: &evm.CallMsg{To: common.HexToAddress(config.Multicall).Bytes(), Data: data},
	}).Await()
	if err != nil {
		return nil, fmt.Errorf("multicall: %w", err)
	}
	results, err := DecodeAggregate3(reply.Data)
	if err != nil || len(results) != len(plan.Calls) {
		return nil, fmt.Errorf("decode multicall: %v", err)
	}

	apis := make([]ApiPrices, 0, len(config.ApiUrls))
	for a, url := range config.ApiUrls {
		paths := make([]string, n)
		for k, t := range config.Tokens {
			paths[k] = t.ApiPaths[a]
		}
		prices, err := http.SendRequest(config, runtime, &http.Client{}, fetchApi(url, paths), cre.ConsensusAggregationFromTags[ApiPrices]()).Await()
		if err != nil {
			logger.Warn("price api unavailable", "url", url, "err", err)
			continue
		}
		apis = append(apis, prices)
	}

	var tokens []common.Address
	var prices []*big.Int
	var halted []bool
	result := &Result{}
	for k, t := range config.Tokens {
		status, err := DecodeStatus(results[plan.Status[k]].ReturnData)
		if err != nil {
			return nil, fmt.Errorf("oracle status for %s: %w", t.Symbol, err)
		}
		obs := Observation{
			Pegged:       t.RefFeed == "",
			Halted:       status.Halted,
			OnchainPrice: status.PriceE18,
			OnchainAt:    status.ObservedAt,
		}
		if plan.Ref[k] >= 0 {
			obs.Ref = FreshFeed(results[plan.Ref[k]], config.FeedDecimals, config.RefMaxAgeSec, now)
		}
		if plan.Market[k] >= 0 {
			obs.Feed = FreshFeed(results[plan.Market[k]], config.FeedDecimals, config.MarketMaxAgeSec, now)
		}
		quotes := make([]*big.Int, 0, len(apis))
		for a := range apis {
			quotes = append(quotes, apis[a].Get(k))
		}
		obs.Api = Median(quotes)

		d := Decide(config, obs, now)
		logger.Info("observed", "token", t.Symbol, "ref", obs.Ref, "feed", obs.Feed, "api", obs.Api,
			"halt", d.Halt, "push", d.Push, "reason", d.Reason)
		if !d.Known {
			continue
		}
		tokens = append(tokens, common.HexToAddress(t.Address))
		prices = append(prices, d.PriceE18)
		halted = append(halted, d.Halt)
		if d.Push {
			result.Pushed = append(result.Pushed, fmt.Sprintf("%s:%t", t.Symbol, d.Halt))
		}
	}

	if len(result.Pushed) == 0 {
		logger.Info("nothing to push")
		return result, nil
	}

	payload, err := EncodeReport(tokens, prices, halted, uint64(now))
	if err != nil {
		return nil, err
	}
	report, err := runtime.GenerateReport(&cre.ReportRequest{
		EncodedPayload: payload,
		EncoderName:    "evm",
		SigningAlgo:    "ecdsa",
		HashingAlgo:    "keccak256",
	}).Await()
	if err != nil {
		return nil, fmt.Errorf("generate report: %w", err)
	}

	resp, err := chain.WriteReport(runtime, &evm.WriteCreReportRequest{
		Receiver:  common.HexToAddress(config.Oracle).Bytes(),
		Report:    report,
		GasConfig: &evm.GasConfig{GasLimit: config.GasLimit},
	}).Await()
	if err != nil {
		return nil, fmt.Errorf("write report: %w", err)
	}
	if resp.TxStatus != evm.TxStatus_TX_STATUS_SUCCESS {
		msg := "unknown"
		if resp.ErrorMessage != nil {
			msg = *resp.ErrorMessage
		}
		return nil, fmt.Errorf("oracle write failed: %s", msg)
	}
	result.TxHash = fmt.Sprintf("0x%x", resp.TxHash)
	logger.Info("oracle updated", "pushed", result.Pushed, "tx", result.TxHash)
	return result, nil
}

func main() {
	wasm.NewRunner(cre.ParseJSON[Config]).Run(InitWorkflow)
}
