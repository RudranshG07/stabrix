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
	Changed []string `json:"changed"`
	TxHash  string   `json:"txHash,omitempty"`
}

func InitWorkflow(config *Config, logger *slog.Logger, _ cre.SecretsProvider) (cre.Workflow[*Config], error) {
	return cre.Workflow[*Config]{
		cre.Handler(cron.Trigger(&cron.Config{Schedule: config.Schedule}), onTick),
	}, nil
}

func fetchPrice(token TokenConfig) func(*Config, *slog.Logger, *http.SendRequester) (*big.Int, error) {
	return func(_ *Config, _ *slog.Logger, r *http.SendRequester) (*big.Int, error) {
		resp, err := r.SendRequest(&http.Request{Url: token.ApiUrl, Method: "GET"}).Await()
		if err != nil {
			return nil, err
		}
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("%s price api status %d", token.Symbol, resp.StatusCode)
		}
		return ParsePriceE8(resp.Body, token.JsonPath)
	}
}

func onTick(config *Config, runtime cre.Runtime, _ *cron.Payload) (*Result, error) {
	logger := runtime.Logger()
	selector, err := evm.ChainSelectorFromName(config.ChainName)
	if err != nil {
		return nil, err
	}
	chain := &evm.Client{ChainSelector: selector}
	sentinel := common.HexToAddress(config.Sentinel)
	now := runtime.Now().Unix()

	n := len(config.Tokens)
	tokens := make([]common.Address, n)
	prices := make([]*big.Int, n)
	halted := make([]bool, n)
	result := &Result{}

	for k, t := range config.Tokens {
		tokens[k] = common.HexToAddress(t.Address)
		obs := Observation{}

		feed, err := chain.CallContract(runtime, &evm.CallContractRequest{
			Call: &evm.CallMsg{To: common.HexToAddress(t.Feed).Bytes(), Data: latestRoundDataSelector},
		}).Await()
		if err == nil {
			obs.FeedE8, obs.FeedUpdatedAt, err = DecodeLatestRound(feed.Data)
		}
		if err != nil {
			logger.Warn("chainlink feed unavailable", "token", t.Symbol, "err", err)
		}

		status, err := chain.CallContract(runtime, &evm.CallContractRequest{
			Call: &evm.CallMsg{To: sentinel.Bytes(), Data: StatusCall(tokens[k])},
		}).Await()
		if err != nil {
			return nil, fmt.Errorf("read sentinel status for %s: %w", t.Symbol, err)
		}
		if obs.Halted, err = DecodeStatus(status.Data); err != nil {
			return nil, err
		}

		api, err := http.SendRequest(config, runtime, &http.Client{}, fetchPrice(t), cre.ConsensusMedianAggregation[*big.Int]()).Await()
		if err != nil {
			logger.Warn("price api unavailable", "token", t.Symbol, "err", err)
		} else {
			obs.ApiE8 = api
		}

		d := Decide(config, obs, now)
		prices[k] = d.PriceE8
		halted[k] = d.Halt
		logger.Info("observed", "token", t.Symbol, "feedE8", obs.FeedE8, "apiE8", obs.ApiE8, "halt", d.Halt, "reason", d.Reason)
		if d.Halt != obs.Halted {
			result.Changed = append(result.Changed, fmt.Sprintf("%s:%t", t.Symbol, d.Halt))
		}
	}

	if len(result.Changed) == 0 {
		logger.Info("no status change, skipping write")
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
		Receiver:  sentinel.Bytes(),
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
		return nil, fmt.Errorf("sentinel write failed: %s", msg)
	}
	result.TxHash = fmt.Sprintf("0x%x", resp.TxHash)
	logger.Info("sentinel updated", "changed", result.Changed, "tx", result.TxHash)
	return result, nil
}

func main() {
	wasm.NewRunner(cre.ParseJSON[Config]).Run(InitWorkflow)
}
