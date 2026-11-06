# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Kapil — People of Product™
import base64
import hashlib
import hmac
import json
import re
from typing import Any, Dict, Mapping, Optional, Union

INTENT_DOMAIN = "payrekha-intent-v1\n"
INTENT_KINDS = ("LOAN_DISBURSAL", "PA_SETTLEMENT", "REFUND", "VDA_WITHDRAWAL", "VENDOR_PAYOUT", "VERIFICATION")
_MAX_SAFE = 2**53 - 1
_MOBILE = re.compile(r"^(?:\+?91|0)?([6-9]\d{9})$")


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def _check(value: Any) -> Any:
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, int):
        if abs(value) > _MAX_SAFE:
            raise ValueError("integers must be JS-safe")
        return value
    if isinstance(value, float):
        raise ValueError("floats are not allowed; use integer paise / epoch ms")
    if isinstance(value, (list, tuple)):
        return [_check(v) for v in value]
    if isinstance(value, Mapping):
        return {str(k): _check(v) for k, v in value.items() if v is not None}
    raise TypeError(f"unsupported type {type(value).__name__}")


def canonical_json(value: Any) -> str:
    """Sorted keys, no whitespace, integers only, None fields dropped — same as canonicalJson()."""
    return json.dumps(_check(value), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def intent_signing_payload(intent: Mapping[str, Any]) -> bytes:
    body = {k: v for k, v in intent.items() if k != "signature"}
    if body.get("kind") not in INTENT_KINDS:
        raise ValueError("unknown intent kind")
    return (INTENT_DOMAIN + canonical_json(body)).encode("utf-8")


def sign_intent_hmac(intent: Mapping[str, Any], secret: str) -> Dict[str, Any]:
    """HMAC-SHA256. Anyone holding the secret can mint intents — prefer Ed25519."""
    if len(secret) < 32:
        raise ValueError("HMAC secret must be at least 32 characters")
    sig = hmac.new(secret.encode("utf-8"), intent_signing_payload(intent), hashlib.sha256).digest()
    return {**intent, "signature": _b64url(sig)}


def sign_intent_ed25519(intent: Mapping[str, Any], private_key: Union[bytes, Any]) -> Dict[str, Any]:
    """Ed25519 (default). ``private_key`` is a 32-byte seed or a cryptography Ed25519PrivateKey."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    key = Ed25519PrivateKey.from_private_bytes(private_key) if isinstance(private_key, (bytes, bytearray)) else private_key
    return {**intent, "signature": _b64url(key.sign(intent_signing_payload(intent)))}


def hash_beneficiary(
    key: Union[str, bytes],
    *,
    account: Optional[str] = None,
    ifsc: Optional[str] = None,
    vpa: Optional[str] = None,
    mobile: Optional[str] = None,
) -> str:
    """Keyed beneficiary ref (``hb1_…``), identical to hashBeneficiary() in @payrekha/core."""
    k = key.encode("utf-8") if isinstance(key, str) else bytes(key)
    if len(k) < 16:
        raise ValueError("hash key must be at least 16 bytes")
    if account is not None:
        acct = re.sub(r"[\s-]", "", account)
        code = (ifsc or "").strip().upper()
        if not re.fullmatch(r"\d{6,20}", acct):
            raise ValueError("account number must be 6-20 digits")
        if not re.fullmatch(r"[A-Z]{4}0[A-Z0-9]{6}", code):
            raise ValueError("IFSC must look like ABCD0123456")
        pre = f"acct:{acct}|{code}"
    elif vpa is not None:
        v = vpa.strip().lower()
        if not re.fullmatch(r"[a-z0-9.\-_]{2,256}@[a-z][a-z0-9.\-]{1,64}", v):
            raise ValueError("VPA must look like name@handle")
        pre = f"vpa:{v}"
    elif mobile is not None:
        m = _MOBILE.match(re.sub(r"[\s-]", "", mobile))
        if m is None:
            raise ValueError("mobile must be a 10-digit Indian number")
        pre = f"mob:{m.group(1)}"
    else:
        raise ValueError("give account+ifsc, vpa or mobile")
    return "hb1_" + _b64url(hmac.new(k, pre.encode("utf-8"), hashlib.sha256).digest())
