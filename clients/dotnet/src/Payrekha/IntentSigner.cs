// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
//
// Signs PayRekha intents inside the system of record. Byte-for-byte
// compatible with signIntent() in @payrekha/core and the shared vectors.
using System.Security.Cryptography;
using System.Text;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;

namespace Payrekha;

public static class IntentSigner
{
    /// <summary>Domain separator — an intent signature can't replay as another message type.</summary>
    public const string IntentDomain = "payrekha-intent-v1\n";

    public static readonly string[] IntentKinds =
        { "LOAN_DISBURSAL", "PA_SETTLEMENT", "REFUND", "VDA_WITHDRAWAL", "VENDOR_PAYOUT", "VERIFICATION" };

    private const long MaxSafe = 9007199254740991L;
    private static readonly byte[] Pkcs8Ed25519Prefix =
        Convert.FromHexString("302e020100300506032b657004220420");

    /// <summary>Sorted keys, no whitespace, integers only, null fields dropped.</summary>
    public static string CanonicalJson(object? v)
    {
        var sb = new StringBuilder();
        Write(sb, v);
        return sb.ToString();
    }

    private static void Write(StringBuilder sb, object? v)
    {
        switch (v)
        {
            case null:
                sb.Append("null"); break;
            case string s:
                WriteString(sb, s); break;
            case bool b:
                sb.Append(b ? "true" : "false"); break;
            case byte or sbyte or short or ushort or int or uint or long:
            {
                long n = Convert.ToInt64(v);
                if (Math.Abs(n) > MaxSafe) throw new ArgumentException("integers must be JS-safe");
                sb.Append(n); break;
            }
            case ulong ul when ul <= (ulong)MaxSafe:
                sb.Append(ul); break;
            case float or double or decimal:
                throw new ArgumentException("floats are not allowed; use integer paise / epoch ms");
            case IDictionary<string, object?> m:
            {
                sb.Append('{');
                bool first = true;
                foreach (var k in m.Keys.Where(k => m[k] is not null).OrderBy(k => k, StringComparer.Ordinal))
                {
                    if (!first) sb.Append(',');
                    first = false;
                    WriteString(sb, k); sb.Append(':');
                    Write(sb, m[k]);
                }
                sb.Append('}'); break;
            }
            case System.Collections.IEnumerable seq:
            {
                sb.Append('[');
                bool first = true;
                foreach (var e in seq)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    Write(sb, e);
                }
                sb.Append(']'); break;
            }
            default:
                throw new ArgumentException($"cannot canonicalize {v.GetType().Name}");
        }
    }

    private static void WriteString(StringBuilder sb, string s)
    {
        sb.Append('"');
        foreach (var c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                case < ' ':
                    sb.Append($"\\u{(int)c:x4}"); break;
                default:
                    sb.Append(c); break;
            }
        }
        sb.Append('"');
    }

    /// <summary>The exact bytes that get signed: domain tag + canonical JSON of every field except signature.</summary>
    public static byte[] SigningPayload(IDictionary<string, object?> intent)
    {
        var body = intent.Where(kv => kv.Key != "signature").ToDictionary(kv => kv.Key, kv => kv.Value);
        if (body.TryGetValue("kind", out var k) && !IntentKinds.Contains(k as string))
            throw new ArgumentException("unknown intent kind");
        return Encoding.UTF8.GetBytes(IntentDomain + CanonicalJson(body));
    }

    private static string B64Url(byte[] b) =>
        Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>Ed25519 private key from a 32-byte seed — deterministic test keys only.</summary>
    public static Ed25519PrivateKeyParameters Ed25519FromSeed(byte[] seed)
    {
        if (seed.Length != 32) throw new ArgumentException("Ed25519 seed must be 32 bytes");
        return new Ed25519PrivateKeyParameters(seed, 0);
    }

    /// <summary>PKCS#8 DER base64 — the format generateIssuerKeyPair() prints.</summary>
    public static Ed25519PrivateKeyParameters Ed25519FromPkcs8(string base64)
    {
        var der = Convert.FromBase64String(base64);
        // PKCS8 Ed25519: 16-byte prefix || OCTET STRING(32-byte seed)
        if (der.Length != 48) throw new ArgumentException("expected 48-byte PKCS8 Ed25519");
        if (!der.AsSpan(0, 16).SequenceEqual(Pkcs8Ed25519Prefix))
            throw new ArgumentException("not an Ed25519 PKCS8 key");
        return new Ed25519PrivateKeyParameters(der, 16);
    }

    /// <summary>Sign an intent with Ed25519. The key stays in the system of record.</summary>
    public static Dictionary<string, object?> SignEd25519(IDictionary<string, object?> intent, Ed25519PrivateKeyParameters key)
    {
        var payload = SigningPayload(intent);
        var signer = new Ed25519Signer();
        signer.Init(true, key);
        signer.BlockUpdate(payload, 0, payload.Length);
        return WithSignature(intent, signer.GenerateSignature());
    }

    /// <summary>Sign with HMAC-SHA256. Anyone holding the secret can mint — prefer Ed25519.</summary>
    public static Dictionary<string, object?> SignHmac(IDictionary<string, object?> intent, string secret)
    {
        if (secret.Length < 32) throw new ArgumentException("HMAC secret must be at least 32 chars");
        var payload = SigningPayload(intent);
        using var h = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        return WithSignature(intent, h.ComputeHash(payload));
    }

    private static Dictionary<string, object?> WithSignature(IDictionary<string, object?> intent, byte[] sig)
    {
        var out_ = new Dictionary<string, object?>(intent) { ["signature"] = B64Url(sig) };
        return out_;
    }

    /// <summary>SPKI-DER base64 of an Ed25519 public key — give this to PayRekha.</summary>
    public static string ExportPublicKey(Ed25519PrivateKeyParameters key)
    {
        var raw = key.GeneratePublicKey().GetEncoded();
        var spki = Convert.FromHexString("302a300506032b6570032100").Concat(raw).ToArray();
        return Convert.ToBase64String(spki);
    }
}
