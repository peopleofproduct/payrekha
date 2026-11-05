## What & why

<!-- One paragraph: what changes and why it's needed -->

## Checklist

- [ ] `npm run build` passes (strict tsc, project references)
- [ ] `npm run typecheck` is clean (includes `tsconfig.test.json`)
- [ ] `npm test` passes — new behaviour has a test
- [ ] `npm run lint` is clean
- [ ] No new runtime dependencies (core/rules stay zero-dep; check `npm run check:deps`)
- [ ] No secrets, credentials, or real beneficiary data — tests use generated/synthetic material only
- [ ] Security-relevant changes note the trust-boundary impact below
- [ ] Docs updated if behaviour, config, or API shape changed

## Trust-boundary notes (if applicable)

<!-- Does this touch intent verification, key handling, hashing,
     fail-open/fail-closed posture, or admin auth? Say what changed. -->
