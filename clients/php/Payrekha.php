<?php
// PayRekha intent signing — PHP ≥7.2 (libsodium built in).
// Byte-conformant with clients/vectors/intent-v1.json.
//   Payrekha::signIntent($unsigned, $pkcs8DerBase64) -> array with 'signature'

final class Payrekha
{
    private const DOMAIN = "payrekha-intent-v1\n";

    // Deterministic JSON: sorted keys, no whitespace, safe integers only.
    public static function canonicalJson($v, int $depth = 0): string
    {
        if ($depth > 64) throw new TypeError('canonicalJson: nests deeper than 64');
        if ($v === null) return 'null';
        if (is_string($v)) return json_encode($v, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (is_bool($v)) return $v ? 'true' : 'false';
        if (is_int($v)) return (string)$v;
        if (is_float($v)) throw new TypeError("canonicalJson: non-integer {$v}");
        if (is_array($v)) {
            if (array_is_list($v)) {
                return '[' . implode(',', array_map(fn($e) => self::canonicalJson($e, $depth + 1), $v)) . ']';
            }
            $keys = array_keys($v);
            usort($keys, 'strcmp');
            return '{' . implode(',', array_map(fn($k) => self::canonicalJson((string)$k, 0) . ':' . self::canonicalJson($v[$k], $depth + 1), $keys)) . '}';
        }
        throw new TypeError('canonicalJson: unsupported ' . gettype($v));
    }

    /** Sign an unsigned intent with a base64 PKCS8 Ed25519 private key. */
    public static function signIntent(array $unsigned, string $pkcs8B64): array
    {
        $der = base64_decode($pkcs8B64, true);
        if ($der === false || strlen($der) < 32) throw new InvalidArgumentException('bad PKCS8 key');
        $seed = substr($der, -32); // PKCS8 Ed25519: trailing 32 bytes
        unset($unsigned['signature']);
        $kp = sodium_crypto_sign_seed_keypair($seed);
        $sig = sodium_crypto_sign_detached(self::DOMAIN . self::canonicalJson($unsigned), sodium_crypto_sign_secretkey($kp));
        $unsigned['signature'] = rtrim(strtr(base64_encode($sig), '+/', '-_'), '=');
        return $unsigned;
    }
}
