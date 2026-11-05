// SPDX-License-Identifier: Apache-2.0

package payrekha

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

type vector struct {
	HashKey     string            `json:"hashKey"`
	Beneficiary map[string]string `json:"beneficiary"`
	Intent      map[string]any    `json:"intent"`
	Payload     string            `json:"payload"`
	HmacSecret  string            `json:"hmacSecret"`
	HmacSig     string            `json:"hmacSignature"`
	Seed        string            `json:"ed25519SeedHex"`
	EdSig       string            `json:"ed25519Signature"`
}

func loadVector(t *testing.T) vector {
	raw, err := os.ReadFile("../vectors/intent-v1.json")
	if err != nil {
		t.Fatal(err)
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.UseNumber()
	var v vector
	if err := d.Decode(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestVector(t *testing.T) {
	v := loadVector(t)
	ref, err := HashBeneficiary(Beneficiary{Account: v.Beneficiary["account"], IFSC: v.Beneficiary["ifsc"]}, []byte(v.HashKey))
	if err != nil || ref != v.Intent["beneficiaryRef"] {
		t.Fatalf("beneficiaryRef %q %v", ref, err)
	}
	p, err := SigningPayload(v.Intent)
	if err != nil || string(p) != v.Payload {
		t.Fatalf("payload %q %v", p, err)
	}
	h, err := SignHMAC(v.Intent, v.HmacSecret)
	if err != nil || h["signature"] != v.HmacSig {
		t.Fatalf("hmac %v %v", h["signature"], err)
	}
	seed, _ := hex.DecodeString(v.Seed)
	e, err := SignEd25519(v.Intent, ed25519.NewKeyFromSeed(seed))
	if err != nil || e["signature"] != v.EdSig {
		t.Fatalf("ed25519 %v %v", e["signature"], err)
	}
}

func TestRejects(t *testing.T) {
	if _, err := CanonicalJSON(map[string]any{"a": 1.5}); err == nil {
		t.Fatal("float accepted")
	}
	if _, err := CanonicalJSON(map[string]any{"a": int64(1) << 60}); err == nil {
		t.Fatal("unsafe int accepted")
	}
	if _, err := SignHMAC(map[string]any{"kind": "REFUND"}, "short"); err == nil {
		t.Fatal("short secret accepted")
	}
	if _, err := SigningPayload(map[string]any{"kind": "NOPE"}); err == nil {
		t.Fatal("unknown kind accepted")
	}
	a, _ := HashBeneficiary(Beneficiary{Mobile: "+91 98765 43210"}, []byte("vector-hash-key-0123456789abcdef"))
	b, _ := HashBeneficiary(Beneficiary{Mobile: "9876543210"}, []byte("vector-hash-key-0123456789abcdef"))
	if a != b || a == "" {
		t.Fatal("mobile normalisation")
	}
	if s, _ := CanonicalJSON(map[string]any{"b": "<&>\u2028", "a": nil}); s != "{\"b\":\"<&>\u2028\"}" {
		t.Fatalf("escaping %q", s)
	}
}

func TestEvaluate(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("authorization") != "Bearer k" {
			w.WriteHeader(401)
			return
		}
		_, _ = w.Write([]byte(`{"verdict":"BLOCK","effectiveAction":"DECLINE","decisionId":"pd_1","hits":[{"rule":"intent.missing","reason":"no intent"}]}`))
	}))
	defer srv.Close()
	c, _ := NewClient(srv.URL, "k", "", 0)
	v, err := c.Evaluate(context.Background(), map[string]any{"amountPaise": 100})
	if err != nil || v.MayProceed() || v.Rules()[0] != "intent.missing" {
		t.Fatalf("%+v %v", v, err)
	}
	bad, _ := NewClient(srv.URL, "wrong", "", 0)
	if _, err := bad.Evaluate(context.Background(), map[string]any{"amountPaise": 100}); err == nil {
		t.Fatal("401 papered over")
	}
}

func TestFailMode(t *testing.T) {
	c, _ := NewClient("http://127.0.0.1:1", "k", "", 0)
	big, _ := c.Evaluate(context.Background(), map[string]any{"amountPaise": 5_000_001})
	small, _ := c.Evaluate(context.Background(), map[string]any{"amountPaise": 5_000_000})
	odd, _ := c.Evaluate(context.Background(), map[string]any{"amountPaise": "lots"})
	if big.MayProceed() || !small.MayProceed() || odd.MayProceed() || !big.Unavailable {
		t.Fatalf("%+v %+v %+v", big, small, odd)
	}
	if _, err := NewClient("x", "k", "sometimes", 0); err == nil {
		t.Fatal("bad fail mode accepted")
	}
}
