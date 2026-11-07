# `intent.approvals-insufficient`

**Default verdict:** BLOCK — or REVIEW when the kind sets `requiredApprovals.onInsufficient: "review"`

**Fires when:** A kind with `firewall.requiredApprovals` gets fewer distinct-issuer intents than it demands. `VDA_WITHDRAWAL: 2` means the payout must cite its primary `intentId` plus one approval from a *different* issuer in `approvalIds`.

**Attack it answers:** One compromised or coerced system-of-record key authorising a payout alone — the crypto-withdrawal scenario CERT-In CIAD-2026-0058 RA19 names. No single party can move the money; the second signature must come from a second trust zone.

**Configuration:** `firewall.requiredApprovals` per kind: a bare count (`{ "VDA_WITHDRAWAL": 2 }`) BLOCKs on insufficiency; `{ count, onInsufficient: "review" }` HOLDs for the maker-checker queue instead — the ramp position while approver systems onboard; `approverIssuers` restricts which issuers count, so approval means the risk desk's keyring signed, not any registered intent.

**Known false positives:** An approver system that is down or unregistered — payouts surface as insufficient rather than `intent.missing`, and the evidence `issuers` shows exactly who did and did not sign. An approval minted by the same gateway still counts as its own issuer — real separation wants an external approver key.

Every hit carries the rule ID, a plain-words reason with ₹ amounts, and structured `evidence` (`required`, `provided`, `issuers`, `onInsufficient`). Tests: `packages/rules/test/rules.test.ts`.
