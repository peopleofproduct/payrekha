# Penny-drop: why naive ₹1 rules fail at lenders

CRAFTY FALCON sends ₹1 to an account before sending ₹4,99,999 to it. The obvious rule is "₹1 followed by a large payout to the same account means REVIEW". At a lender that rule fires on almost every good loan, because lenders run a ₹1 **penny-drop** to verify the borrower's bank account before every disbursal. The legitimate flow looks exactly like the attack.

| | Legitimate lender | Attacker |
|---|---|---|
| ₹1 to new account | Penny-drop verification | Probe |
| Minutes later | ₹2,40,000 disbursal | ₹4,99,999 payout |
| Who decided | LOS sanctioned the loan | Nobody |

The difference is not in the amounts. It is in who decided the payout should happen.

## How Payrekha tells them apart

1. The LOS signs a `VERIFICATION` intent for the ₹1 and a `LOAN_DISBURSAL` intent for the loan, both bound to the same hashed beneficiary.
2. `probe.micro-then-large` remembers micro-payouts per beneficiary and marks the ones made under a valid `VERIFICATION` intent as verified.
3. A large payout to a beneficiary that was verified that way, and that carries its own valid bound intent, is not a probe. It produces **no REVIEW**. The test suite covers exactly this case.
4. A ₹1 payout without a verification intent, followed by a large payout, is reviewed, and blocked in `HIGH_ALERT`.

`beneficiary.cooling` (a large payout to a beneficiary first seen minutes ago) also skips payouts that carry a valid intent for that exact beneficiary. A first disbursal is always to a new account, so without this exemption every good loan would be held. Set `exemptBoundIntents: false` to remove the exemption.

In intent-less replay, which you run on Day 1 before any intents exist, these same good loans *will* show up in the false-positive list. That is the honest picture of what a ₹1 rule costs you without intents.
