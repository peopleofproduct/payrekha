// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™

// Package payrekha signs PayRekha intents and calls the PayRekha gateway.
// Standard library only. Signatures are byte-for-byte compatible with @payrekha/core.
package payrekha

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// IntentDomain prefixes every signed payload.
const IntentDomain = "payrekha-intent-v1\n"

// IntentKinds lists the intent kinds PayRekha understands.
var IntentKinds = []string{"LOAN_DISBURSAL", "PA_SETTLEMENT", "REFUND", "VDA_WITHDRAWAL", "VENDOR_PAYOUT", "VERIFICATION"}

const maxSafe = 1<<53 - 1

// CanonicalJSON matches canonicalJson() in @payrekha/core: sorted keys, no
// whitespace, nil fields dropped, integers only (JS-safe range).
func CanonicalJSON(v any) (string, error) {
	var b strings.Builder
	if err := writeCanonical(&b, v); err != nil {
		return "", err
	}
	return b.String(), nil
}

func writeCanonical(b *strings.Builder, v any) error {
	switch x := v.(type) {
	case nil:
		b.WriteString("null")
	case bool:
		b.WriteString(strconv.FormatBool(x))
	case string:
		writeString(b, x)
	case int:
		return writeInt(b, int64(x))
	case int32:
		return writeInt(b, int64(x))
	case int64:
		return writeInt(b, x)
	case uint32:
		return writeInt(b, int64(x))
	case json.Number:
		n, err := x.Int64()
		if err != nil {
			return fmt.Errorf("payrekha: %q is not an integer; use integer paise / epoch ms", x)
		}
		return writeInt(b, n)
	case float32, float64:
		f := toFloat(x)
		if f != math.Trunc(f) || math.IsInf(f, 0) {
			return errors.New("payrekha: floats are not allowed; use integer paise / epoch ms")
		}
		return writeInt(b, int64(f))
	case []any:
		b.WriteByte('[')
		for i, e := range x {
			if i > 0 {
				b.WriteByte(',')
			}
			if err := writeCanonical(b, e); err != nil {
				return err
			}
		}
		b.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(x))
		for k, e := range x {
			if e != nil {
				keys = append(keys, k)
			}
		}
		sort.Strings(keys)
		b.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				b.WriteByte(',')
			}
			writeString(b, k)
			b.WriteByte(':')
			if err := writeCanonical(b, x[k]); err != nil {
				return err
			}
		}
		b.WriteByte('}')
	default:
		return fmt.Errorf("payrekha: unsupported type %T", v)
	}
	return nil
}

func toFloat(v any) float64 {
	if f, ok := v.(float32); ok {
		return float64(f)
	}
	return v.(float64)
}

func writeInt(b *strings.Builder, n int64) error {
	if n > maxSafe || n < -maxSafe {
		return errors.New("payrekha: integers must be JS-safe")
	}
	b.WriteString(strconv.FormatInt(n, 10))
	return nil
}

// writeString escapes exactly like JSON.stringify.
func writeString(b *strings.Builder, s string) {
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		case '\b':
			b.WriteString(`\b`)
		case '\f':
			b.WriteString(`\f`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			if r < 0x20 {
				fmt.Fprintf(b, `\u%04x`, r)
			} else {
				b.WriteRune(r)
			}
		}
	}
	b.WriteByte('"')
}

// SigningPayload returns the exact bytes that are signed for an intent.
func SigningPayload(intent map[string]any) ([]byte, error) {
	body := make(map[string]any, len(intent))
	for k, v := range intent {
		if k != "signature" {
			body[k] = v
		}
	}
	kind, _ := body["kind"].(string)
	known := false
	for _, k := range IntentKinds {
		known = known || k == kind
	}
	if !known {
		return nil, errors.New("payrekha: unknown intent kind")
	}
	c, err := CanonicalJSON(body)
	if err != nil {
		return nil, err
	}
	return []byte(IntentDomain + c), nil
}

func withSignature(intent map[string]any, sig []byte) map[string]any {
	out := make(map[string]any, len(intent)+1)
	for k, v := range intent {
		out[k] = v
	}
	out["signature"] = base64.RawURLEncoding.EncodeToString(sig)
	return out
}

// SignEd25519 signs with Ed25519 (the default). The key stays in the system of record.
func SignEd25519(intent map[string]any, key ed25519.PrivateKey) (map[string]any, error) {
	p, err := SigningPayload(intent)
	if err != nil {
		return nil, err
	}
	return withSignature(intent, ed25519.Sign(key, p)), nil
}

// SignHMAC signs with HMAC-SHA256. Anyone holding the secret can mint intents; prefer Ed25519.
func SignHMAC(intent map[string]any, secret string) (map[string]any, error) {
	if len(secret) < 32 {
		return nil, errors.New("payrekha: HMAC secret must be at least 32 characters")
	}
	p, err := SigningPayload(intent)
	if err != nil {
		return nil, err
	}
	m := hmac.New(sha256.New, []byte(secret))
	m.Write(p)
	return withSignature(intent, m.Sum(nil)), nil
}

// Beneficiary identifies a payee. Set Account+IFSC, VPA, or Mobile.
type Beneficiary struct {
	Account, IFSC, VPA, Mobile string
}

var (
	reSpace  = regexp.MustCompile(`[\s-]`)
	reAcct   = regexp.MustCompile(`^\d{6,20}$`)
	reIFSC   = regexp.MustCompile(`^[A-Z]{4}0[A-Z0-9]{6}$`)
	reVPA    = regexp.MustCompile(`^[a-z0-9.\-_]{2,256}@[a-z][a-z0-9.\-]{1,64}$`)
	reMobile = regexp.MustCompile(`^(?:\+?91|0)?([6-9]\d{9})$`)
)

// HashBeneficiary returns the keyed ref ("hb1_…"), identical to hashBeneficiary() in @payrekha/core.
func HashBeneficiary(b Beneficiary, key []byte) (string, error) {
	if len(key) < 16 {
		return "", errors.New("payrekha: hash key must be at least 16 bytes")
	}
	var pre string
	switch {
	case b.Account != "":
		acct := reSpace.ReplaceAllString(b.Account, "")
		code := strings.ToUpper(strings.TrimSpace(b.IFSC))
		if !reAcct.MatchString(acct) {
			return "", errors.New("payrekha: account number must be 6-20 digits")
		}
		if !reIFSC.MatchString(code) {
			return "", errors.New("payrekha: IFSC must look like ABCD0123456")
		}
		pre = "acct:" + acct + "|" + code
	case b.VPA != "":
		v := strings.ToLower(strings.TrimSpace(b.VPA))
		if !reVPA.MatchString(v) {
			return "", errors.New("payrekha: VPA must look like name@handle")
		}
		pre = "vpa:" + v
	case b.Mobile != "":
		m := reMobile.FindStringSubmatch(reSpace.ReplaceAllString(b.Mobile, ""))
		if m == nil {
			return "", errors.New("payrekha: mobile must be a 10-digit Indian number")
		}
		pre = "mob:" + m[1]
	default:
		return "", errors.New("payrekha: give Account+IFSC, VPA or Mobile")
	}
	h := hmac.New(sha256.New, key)
	h.Write([]byte(pre))
	return "hb1_" + base64.RawURLEncoding.EncodeToString(h.Sum(nil)), nil
}
