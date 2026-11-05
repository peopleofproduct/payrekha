# SPDX-License-Identifier: Apache-2.0
import json
import pathlib
import unittest

from payrekha import canonical_json, hash_beneficiary, intent_signing_payload, sign_intent_ed25519, sign_intent_hmac

VEC = json.loads((pathlib.Path(__file__).resolve().parents[2] / "vectors" / "intent-v1.json").read_text("utf-8"))


class IntentVectorTest(unittest.TestCase):
    def test_beneficiary_ref(self):
        b = VEC["beneficiary"]
        self.assertEqual(hash_beneficiary(VEC["hashKey"], account=b["account"], ifsc=b["ifsc"]), VEC["intent"]["beneficiaryRef"])

    def test_payload(self):
        self.assertEqual(intent_signing_payload(VEC["intent"]).decode("utf-8"), VEC["payload"])

    def test_hmac(self):
        self.assertEqual(sign_intent_hmac(VEC["intent"], VEC["hmacSecret"])["signature"], VEC["hmacSignature"])

    def test_ed25519(self):
        try:
            import cryptography  # noqa: F401
        except ImportError:
            self.skipTest("cryptography not installed")
        signed = sign_intent_ed25519(VEC["intent"], bytes.fromhex(VEC["ed25519SeedHex"]))
        self.assertEqual(signed["signature"], VEC["ed25519Signature"])

    def test_rejects_floats_and_short_secrets(self):
        with self.assertRaises(ValueError):
            canonical_json({"a": 1.5})
        with self.assertRaises(ValueError):
            sign_intent_hmac(VEC["intent"], "short")

    def test_mobile_normalisation(self):
        self.assertEqual(hash_beneficiary(VEC["hashKey"], mobile="+91 98765 43210"), hash_beneficiary(VEC["hashKey"], mobile="9876543210"))


if __name__ == "__main__":
    unittest.main()
