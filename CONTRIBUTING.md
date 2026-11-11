# Contributing

Thanks for helping. Small, focused pull requests are easiest to review.

```bash
npm ci
npm run typecheck && npm run lint && npm test
npm run demo                   # must still end with "₹0 left the building."
npm run bench                  # p99 must stay well under 1 ms in-process
```

Optional local gate — install once and typecheck+lint run before every commit:

```bash
cp scripts/pre-commit.sh .git/hooks/pre-commit
```

Ground rules:

- **Safety by default.** When a change trades safety for convenience, the safe behaviour is the default and the convenience is a documented option.
- **Never a silent ALLOW.** Malformed or missing input must produce `REVIEW` with `degraded: true`.
- **Integer paise, epoch ms.** No floating-point money.
- **No raw PII.** Beneficiaries are `hb1_` keyed hashes; add a test if you touch logging or state.
- **Zero runtime deps** in `@payrekha/core` and `@payrekha/rules`, and no network calls there.
- **Every rule** has a stable ID, a plain-words reason with ₹ amounts, structured evidence, tests including a false-positive case, and a page in `docs/rules/`.
- Sign your commits (`git commit -S`). By contributing you agree your work is licensed under Apache-2.0.
