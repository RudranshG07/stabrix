package main

import (
	"bytes"
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

var cfg = &Config{HardBps: 300, SoftBps: 75, ResumeBps: 25, MaxFeedAgeSec: 86_400}

func e8(v int64) *big.Int { return big.NewInt(v) }

func TestSelectorsMatchSignatures(t *testing.T) {
	if !bytes.Equal(latestRoundDataSelector, crypto.Keccak256([]byte("latestRoundData()"))[:4]) {
		t.Fatal("latestRoundData selector")
	}
	if !bytes.Equal(statusSelector, crypto.Keccak256([]byte("status(address)"))[:4]) {
		t.Fatal("status selector")
	}
}

func TestDecide(t *testing.T) {
	now := int64(1_000_000)
	fresh := now - 60
	stale := now - 2*86_400
	cases := []struct {
		name string
		obs  Observation
		halt bool
	}{
		{"at peg", Observation{FeedE8: e8(99_990_000), FeedUpdatedAt: fresh, ApiE8: e8(100_010_000)}, false},
		{"offchain hard depeg halts alone", Observation{FeedE8: e8(99_990_000), FeedUpdatedAt: fresh, ApiE8: e8(93_000_000)}, true},
		{"chainlink hard depeg halts alone", Observation{FeedE8: e8(96_000_000), FeedUpdatedAt: fresh, ApiE8: e8(99_000_000)}, true},
		{"one soft source does not halt", Observation{FeedE8: e8(100_000_000), FeedUpdatedAt: fresh, ApiE8: e8(99_100_000)}, false},
		{"both soft sources halt", Observation{FeedE8: e8(99_200_000), FeedUpdatedAt: fresh, ApiE8: e8(99_100_000)}, true},
		{"stale feed is ignored", Observation{FeedE8: e8(90_000_000), FeedUpdatedAt: stale, ApiE8: e8(100_000_000)}, false},
		{"depeg above peg also halts", Observation{FeedE8: e8(100_000_000), FeedUpdatedAt: fresh, ApiE8: e8(104_000_000)}, true},
		{"halted stays halted outside resume band", Observation{FeedE8: e8(99_500_000), FeedUpdatedAt: fresh, ApiE8: e8(99_600_000), Halted: true}, true},
		{"halted resumes inside resume band", Observation{FeedE8: e8(99_900_000), FeedUpdatedAt: fresh, ApiE8: e8(99_850_000), Halted: true}, false},
		{"halted stays halted with no data", Observation{Halted: true}, true},
		{"no data and not halted stays open", Observation{}, false},
	}
	for _, c := range cases {
		if got := Decide(cfg, c.obs, now); got.Halt != c.halt {
			t.Errorf("%s: halt=%v want %v (%s)", c.name, got.Halt, c.halt, got.Reason)
		}
	}
}

func TestDecidePrefersOffchainPrice(t *testing.T) {
	d := Decide(cfg, Observation{FeedE8: e8(99_990_000), FeedUpdatedAt: 10, ApiE8: e8(93_000_000)}, 20)
	if d.PriceE8.Cmp(e8(93_000_000)) != 0 {
		t.Fatalf("price %s", d.PriceE8)
	}
}

func TestParsePrice(t *testing.T) {
	cases := []struct {
		body string
		path string
		want int64
	}{
		{`{"ethena-usde":{"usd":0.9993}}`, "ethena-usde.usd", 99_930_000},
		{`{"usd-coin":{"usd":1}}`, "usd-coin.usd", 100_000_000},
		{`{"price":"0.93"}`, "price", 93_000_000},
		{`{"price":0.12345678}`, "price", 12_345_678},
	}
	for _, c := range cases {
		got, err := ParsePriceE8([]byte(c.body), c.path)
		if err != nil || got.Int64() != c.want {
			t.Errorf("%s %s: got %v err %v want %d", c.body, c.path, got, err, c.want)
		}
	}
	for _, bad := range []struct{ body, path string }{{`{"a":1}`, "b"}, {`{"a":{"b":true}}`, "a.b"}, {`nope`, "a"}} {
		if _, err := ParsePriceE8([]byte(bad.body), bad.path); err == nil {
			t.Errorf("expected error for %s %s", bad.body, bad.path)
		}
	}
}

func TestEncodeReportMatchesCast(t *testing.T) {
	want := common.FromHex("0x000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000140000000000000000000000000000000000000000000000000000000006aecbde00000000000000000000000000000000000000000000000000000000000000002000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda029130000000000000000000000005d3a1ff2b6bab83b63cd9ad0787074081a52ef3400000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000005f5a55400000000000000000000000000000000000000000000000000000000058b1140000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001")
	got, err := EncodeReport(
		[]common.Address{
			common.HexToAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
			common.HexToAddress("0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34"),
		},
		[]*big.Int{e8(99_984_724), e8(93_000_000)},
		[]bool{false, true},
		1_793_900_000,
	)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("report encoding mismatch: %x", got)
	}
}

func TestDecodeLatestRound(t *testing.T) {
	data, _ := roundOut.Pack(big.NewInt(5), big.NewInt(99_984_724), big.NewInt(1), big.NewInt(1_700_000_000), big.NewInt(5))
	answer, updated, err := DecodeLatestRound(data)
	if err != nil || answer.Int64() != 99_984_724 || updated != 1_700_000_000 {
		t.Fatalf("decode: %v %d %v", answer, updated, err)
	}
}
