// SPDX-License-Identifier: Apache-2.0
// Round-trip against clients/vectors/intent-v1.json — the same file the
// JS/Java/Go/Python signers verify. dotnet run from tests/VectorTest.
using System.Text;
using System.Text.Json;
using Payrekha;

var vecPath = args.Length > 0 ? args[0] : "../../../../vectors/intent-v1.json";
var vec = JsonDocument.Parse(File.ReadAllText(vecPath)).RootElement;

void Check(string what, string expected, string actual)
{
    if (expected != actual) { Console.Error.WriteLine($"FAIL {what}\n  exp {expected}\n  act {actual}"); Environment.Exit(1); }
    Console.WriteLine($"ok   {what}");
}

var ben = new Dictionary<string, string> {
    ["account"] = vec.GetProperty("beneficiary").GetProperty("account").GetString()!,
    ["ifsc"] = vec.GetProperty("beneficiary").GetProperty("ifsc").GetString()! };
Check("beneficiaryRef", vec.GetProperty("intent").GetProperty("beneficiaryRef").GetString()!,
      Beneficiary.Hash(ben, vec.GetProperty("hashKey").GetString()!));

var intent = new Dictionary<string, object?>();
foreach (var p in vec.GetProperty("intent").EnumerateObject())
    intent[p.Name] = p.Value.ValueKind == JsonValueKind.Number ? p.Value.GetInt64() : p.Value.GetString();

Check("payload", vec.GetProperty("payload").GetString()!,
      Encoding.UTF8.GetString(IntentSigner.SigningPayload(intent)));
Check("hmac", vec.GetProperty("hmacSignature").GetString()!,
      IntentSigner.SignHmac(intent, vec.GetProperty("hmacSecret").GetString()!)["signature"]!.ToString()!);

var key = IntentSigner.Ed25519FromSeed(Convert.FromHexString(vec.GetProperty("ed25519SeedHex").GetString()!));
Check("ed25519 pub", vec.GetProperty("ed25519PublicKey").GetString()!, IntentSigner.ExportPublicKey(key));
Check("ed25519 sig", vec.GetProperty("ed25519Signature").GetString()!,
      IntentSigner.SignEd25519(intent, key)["signature"]!.ToString()!);

try { IntentSigner.CanonicalJson(new Dictionary<string, object?> { ["a"] = 1.5 }); Check("float rejected", "throws", "no throw"); }
catch (ArgumentException) { Console.WriteLine("ok   float rejected"); }

Console.WriteLine("all vectors pass");
