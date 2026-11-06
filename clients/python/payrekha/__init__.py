# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Kapil — People of Product™
"""PayRekha intent signing for systems of record (LOS/LMS, settlement engines).

Standard library only for HMAC; Ed25519 signing uses the optional
``cryptography`` package. Byte-for-byte compatible with @payrekha/core.
"""
from .client import DEFAULT_ON_UNAVAILABLE, PayrekhaClient
from .intent import (
    INTENT_DOMAIN,
    INTENT_KINDS,
    canonical_json,
    hash_beneficiary,
    intent_signing_payload,
    sign_intent_ed25519,
    sign_intent_hmac,
)

__all__ = [
    "DEFAULT_ON_UNAVAILABLE",
    "PayrekhaClient",
    "INTENT_DOMAIN",
    "INTENT_KINDS",
    "canonical_json",
    "hash_beneficiary",
    "intent_signing_payload",
    "sign_intent_ed25519",
    "sign_intent_hmac",
]
__version__ = "0.1.0a0"
