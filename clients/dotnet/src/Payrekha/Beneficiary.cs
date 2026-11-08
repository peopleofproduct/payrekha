// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Kapil — People of Product™
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Payrekha;

/// <summary>Keyed HMAC of a beneficiary — the "hb1_" ref. Matches hash.ts byte-for-byte.</summary>
public static class Beneficiary
{
    private static readonly Regex Mobile = new(@"^(?:\+?91|0)?([6-9]\d{9})$", RegexOptions.Compiled);

    public static string? NormalizeMobile(string input)
    {
        var m = Mobile.Match(Regex.Replace(input, @"[\s\-()]", ""));
        return m.Success ? m.Groups[1].Value : null;
    }

    public static string Preimage(object id)
    {
        if (id is Dictionary<string, string> d)
        {
            if (d.TryGetValue("account", out var acct))
            {
                var a = Regex.Replace(acct, @"[\s-]", "");
                var ifsc = d["ifsc"].Trim().ToUpperInvariant();
                if (!Regex.IsMatch(a, @"^\d{6,20}$")) throw new ArgumentException("account number must be 6–20 digits");
                if (!Regex.IsMatch(ifsc, @"^[A-Z]{4}0[A-Z0-9]{6}$")) throw new ArgumentException("IFSC must look like ABCD0123456");
                return $"acct:{a}|{ifsc}";
            }
            if (d.TryGetValue("vpa", out var vpa))
            {
                var v = vpa.Trim().ToLowerInvariant();
                if (!Regex.IsMatch(v, @"^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,64}$")) throw new ArgumentException("VPA must look like name@handle");
                return $"vpa:{v}";
            }
            if (d.TryGetValue("mobile", out var mob))
            {
                var m = NormalizeMobile(mob) ?? throw new ArgumentException("mobile must be a 10-digit Indian number");
                return $"mob:{m}";
            }
            if (d.TryGetValue("address", out var addr))
                return $"vda:{d["network"].Trim().ToLowerInvariant()}:{addr.Trim()}";
        }
        throw new ArgumentException("a beneficiary identifier is required: {account,ifsc} | {vpa} | {mobile} | {address,network}");
    }

    /// <summary>Keyed HMAC-SHA256, base64url, "hb1_" prefix. Same key everywhere a ref is produced.</summary>
    public static string Hash(object id, string key)
    {
        if (key.Length < 16) throw new ArgumentException("beneficiary HMAC key must be at least 16 bytes");
        using var h = new HMACSHA256(Encoding.UTF8.GetBytes(key));
        var d = h.ComputeHash(Encoding.UTF8.GetBytes(Preimage(id)));
        return "hb1_" + Convert.ToBase64String(d).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
}
