// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

package payrekha

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// DefaultOnUnavailable holds anything above ₹50,000 when the gateway cannot be reached.
const DefaultOnUnavailable = "hold-above:5000000"

// Verdict is what a payout service acts on.
type Verdict struct {
	Verdict         string `json:"verdict"`
	EffectiveAction string `json:"effectiveAction"`
	DecisionID      string `json:"decisionId"`
	Degraded        bool   `json:"degraded"`
	Hits            []struct {
		Rule   string `json:"rule"`
		Reason string `json:"reason"`
	} `json:"hits"`
	// Unavailable is true when the fail mode produced this verdict, not the gateway.
	Unavailable bool `json:"-"`
}

// MayProceed reports whether the money may move.
func (v Verdict) MayProceed() bool { return v.EffectiveAction == "ALLOW" }

// Rules lists the rule IDs that fired.
func (v Verdict) Rules() []string {
	r := make([]string, len(v.Hits))
	for i, h := range v.Hits {
		r[i] = h.Rule
	}
	return r
}

// Client calls the Payrekha gateway.
type Client struct {
	BaseURL string
	APIKey  string
	HTTP    *http.Client
	// holdAbove: -1 holds everything, -2 allows everything, n holds amounts above n paise.
	holdAbove     int64
	onUnavailable string
}

// NewClient builds a client. onUnavailable is "allow", "hold" or "hold-above:<paise>"; "" means DefaultOnUnavailable.
func NewClient(baseURL, apiKey, onUnavailable string, timeout time.Duration) (*Client, error) {
	if onUnavailable == "" {
		onUnavailable = DefaultOnUnavailable
	}
	if timeout == 0 {
		timeout = 500 * time.Millisecond
	}
	var t int64
	switch {
	case onUnavailable == "allow":
		t = -2
	case onUnavailable == "hold":
		t = -1
	case strings.HasPrefix(onUnavailable, "hold-above:"):
		n, err := strconv.ParseInt(strings.TrimPrefix(onUnavailable, "hold-above:"), 10, 64)
		if err != nil || n < 0 {
			return nil, errors.New("payrekha: bad hold-above amount")
		}
		t = n
	default:
		return nil, errors.New("payrekha: onUnavailable must be 'allow', 'hold' or 'hold-above:<paise>'")
	}
	return &Client{BaseURL: strings.TrimRight(baseURL, "/"), APIKey: apiKey, HTTP: &http.Client{Timeout: timeout}, holdAbove: t, onUnavailable: onUnavailable}, nil
}

// HTTPError is a non-2xx answer from the gateway.
type HTTPError struct {
	Status int
	Body   string
}

func (e *HTTPError) Error() string { return fmt.Sprintf("payrekha: HTTP %d: %s", e.Status, e.Body) }

func (c *Client) call(ctx context.Context, method, path string, body, out any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("authorization", "Bearer "+c.APIKey)
	req.Header.Set("content-type", "application/json")
	res, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(res.Body); err != nil {
		return err
	}
	if res.StatusCode >= 300 && res.StatusCode != http.StatusMultiStatus && res.StatusCode != http.StatusUnprocessableEntity {
		return &HTTPError{Status: res.StatusCode, Body: buf.String()}
	}
	return json.Unmarshal(buf.Bytes(), out)
}

// Evaluate asks the gateway about a payout. If the gateway is unreachable or
// answers 5xx, the fail mode decides; it never silently allows above it.
// Auth and request errors (4xx) are returned, not papered over.
func (c *Client) Evaluate(ctx context.Context, payout map[string]any) (Verdict, error) {
	var v Verdict
	err := c.call(ctx, http.MethodPost, "/v1/evaluate", payout, &v)
	var he *HTTPError
	if err == nil {
		return v, nil
	}
	if errors.As(err, &he) && he.Status < 500 {
		return Verdict{}, err
	}
	amount, ok := toInt(payout["amountPaise"])
	hold := c.holdAbove != -2 && (c.holdAbove == -1 || !ok || amount > c.holdAbove)
	if hold {
		return Verdict{Verdict: "REVIEW", EffectiveAction: "HOLD", Degraded: true, Unavailable: true}, nil
	}
	return Verdict{Verdict: "ALLOW", EffectiveAction: "ALLOW", Degraded: true, Unavailable: true}, nil
}

func toInt(v any) (int64, bool) {
	switch x := v.(type) {
	case int:
		return int64(x), true
	case int64:
		return x, true
	case json.Number:
		n, err := x.Int64()
		return n, err == nil
	}
	return 0, false
}

// RegisterIntent sends a signed intent. The result says whether it was accepted and why not.
func (c *Client) RegisterIntent(ctx context.Context, intent map[string]any) (map[string]any, error) {
	out := map[string]any{}
	return out, c.call(ctx, http.MethodPost, "/v1/intents", intent, &out)
}

// ReportOutcome tells Payrekha what the bank did with a payout: settled, failed or reversed.
func (c *Client) ReportOutcome(ctx context.Context, payoutID, outcome string) error {
	out := map[string]any{}
	return c.call(ctx, http.MethodPost, "/v1/outcomes", map[string]any{"payoutId": payoutID, "outcome": outcome}, &out)
}
