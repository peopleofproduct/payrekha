//! PayRekha intent signing — Rust. Byte-conformant with clients/vectors/intent-v1.json.
//! Deps: ed25519-dalek, serde_json, base64ct (or base64).
//!
//! ```ignore
//! let signed = sign_intent(unsigned_value, pkcs8_b64)?; // adds "signature" (base64url)
//! ```

use ed25519_dalek::{Signer, SigningKey};
use serde_json::{json, Value};

const DOMAIN: &str = "payrekha-intent-v1\n";
const MAX_DEPTH: usize = 64;

/// Deterministic JSON: sorted keys, no whitespace, safe integers only —
/// floats are rejected so no signer can disagree on number formatting.
pub fn canonical_json(v: &Value, depth: usize) -> Result<String, String> {
    if depth > MAX_DEPTH {
        return Err("canonicalJson: nests deeper than 64".into());
    }
    Ok(match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => {
            if n.is_i64() || n.is_u64() {
                n.to_string()
            } else {
                return Err(format!("canonicalJson: non-integer {n}"));
            }
        }
        Value::String(s) => serde_json::to_string(s).map_err(|e| e.to_string())?,
        Value::Array(a) => {
            let mut out = String::from("[");
            for (i, e) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&canonical_json(e, depth + 1)?);
            }
            out.push(']');
            out
        }
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort();
            let mut out = String::from("{");
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(k).map_err(|e| e.to_string())?);
                out.push(':');
                out.push_str(&canonical_json(&m[*k], depth + 1)?);
            }
            out.push('}');
            out
        }
    })
}

/// Sign an unsigned intent (object without `signature`) using a base64
/// PKCS8 Ed25519 private key. Returns the intent with `signature` added.
pub fn sign_intent(mut unsigned: Value, pkcs8_b64: &str) -> Result<Value, String> {
    use base64ct::{Base64, Base64UrlUnpadded, Encoding};
    let der = Base64::decode_vec(pkcs8_b64).map_err(|e| e.to_string())?;
    let seed: &[u8; 32] = der
        .get(der.len().saturating_sub(32)..)
        .and_then(|s| s.try_into().ok())
        .ok_or("bad PKCS8 key")?;
    let obj = unsigned.as_object_mut().ok_or("intent must be an object")?;
    obj.remove("signature");
    let payload = format!("{DOMAIN}{}", canonical_json(&unsigned, 0)?);
    let sig = SigningKey::from_bytes(seed).sign(payload.as_bytes());
    obj.insert("signature".into(), json!(Base64UrlUnpadded::encode_string(&sig.to_bytes())));
    Ok(unsigned)
}
