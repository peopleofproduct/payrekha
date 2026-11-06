# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Kapil — People of Product™
"""Stdlib-only client for the PayRekha gateway, with an explicit fail mode."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Dict, Optional

DEFAULT_ON_UNAVAILABLE = "hold-above:5000000"  # ₹50,000


def _threshold(on_unavailable: str) -> Optional[int]:
    """None = allow all, -1 = hold all, n = hold above n paise."""
    if on_unavailable == "allow":
        return None
    if on_unavailable == "hold":
        return -1
    if on_unavailable.startswith("hold-above:"):
        n = on_unavailable.split(":", 1)[1]
        if n.isdigit():
            return int(n)
    raise ValueError("on_unavailable must be 'allow', 'hold' or 'hold-above:<paise>'")


class PayrekhaClient:
    def __init__(self, base_url: str, api_key: str, on_unavailable: str = DEFAULT_ON_UNAVAILABLE, timeout_s: float = 0.5) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout_s = timeout_s
        self._threshold = _threshold(on_unavailable)
        self.on_unavailable = on_unavailable

    def _call(self, method: str, path: str, body: Any = None) -> Any:
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base_url + path, data=data, method=method, headers={"authorization": f"Bearer {self.api_key}", "content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as r:
                return json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            payload = e.read()
            try:
                return json.loads(payload)
            except ValueError:
                raise
        # URLError / timeouts propagate to the caller of _call

    def evaluate(self, payout: Dict[str, Any]) -> Dict[str, Any]:
        """Evaluate a payout. If the gateway is unreachable, apply the fail mode — never silently allow above it."""
        try:
            return self._call("POST", "/v1/evaluate", payout)
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            amount = payout.get("amountPaise")
            hold = self._threshold is not None and (self._threshold < 0 or not isinstance(amount, int) or amount > self._threshold)
            return {
                "verdict": "REVIEW" if hold else "ALLOW",
                "effectiveAction": "HOLD" if hold else "ALLOW",
                "degraded": True,
                "unavailable": True,
                "onUnavailable": self.on_unavailable,
                "hits": [],
                "error": type(e).__name__,
            }

    def register_intent(self, intent: Dict[str, Any]) -> Dict[str, Any]:
        return self._call("POST", "/v1/intents", intent)

    def report_outcome(self, payout_id: str, outcome: str) -> Dict[str, Any]:
        return self._call("POST", "/v1/outcomes", {"payoutId": payout_id, "outcome": outcome})
