# Repository settings

PayRekha asks operators to protect their payout path; the repository holds itself to the same bar (CIAD-2026-0058 also asks for signed commits and protected branches).

- **Branch protection on `main`:** require pull requests, 1 approving review (2 for `packages/core` and `packages/rules` via CODEOWNERS), dismiss stale approvals, require status checks `build-test (22)`, `build-test (24)`, `java-client`, `python-client`, `docker`, `secrets`; no force-push, no deletion; include administrators.
- **Signed commits:** require signed commits on `main`.
- **Secret scanning:** enable GitHub secret scanning and push protection; `gitleaks` also runs in CI.
- **Actions:** default `GITHUB_TOKEN` permissions read-only; release workflow requests `id-token: write` only for keyless signing and attestations. All third-party actions are pinned to a commit SHA (the `uses:` comment records the version tag); Dependabot updates the pins.
- **Releases:** tags `v*` only from `main`; npm publish uses `--provenance` (tag `alpha` for prereleases; `latest` tracks the newest release until 1.0, then stable only); images are signed with cosign and carry SLSA provenance and a CycloneDX SBOM. The Python client publishes to PyPI via OIDC trusted publishing (`pypi.yml`, environment `pypi`) — no API token in the repo.
- **npm credential posture:** both npm-touching jobs (`release.yml` publish, `npm-admin.yml` dispatch) run in the protected `npm` environment — a required reviewer must approve before `NPM_TOKEN` is exposed to the job. The token itself must be a **granular access token scoped to `@payrekha/*` with an expiry date** (npm → Access Tokens → Granular). CIAD-2026-0058 asks for short-lived deploy tokens; a granular + expiring + approval-gated token is the interim posture. **Target state: npm trusted publishing** — configure it per package on npmjs.com (package → Settings → Publishing access → GitHub Actions, repo `peopleofproduct/payrekha`, workflow `release.yml`); `npm publish --provenance` then works on OIDC alone and `NPM_TOKEN` is deleted from repo secrets. `npm-admin.yml` keeps a scoped token for dist-tag/deprecation maintenance, or those commands move to a maintainer's local login.
- **Dependabot:** enabled for npm, GitHub Actions, Docker, the Go client and the Python client (`.github/dependabot.yml`).
- **Social preview:** `docs/assets/payrekha-social-preview-1280x640.png` is the README hero, but GitHub does not pick it up automatically — it must also be uploaded under **Settings → General → Social preview**, or links to the repo render GitHub's generic card.
- **Topics:** `fraud-prevention`, `payments`, `upi`, `fintech`, `india`, `cybersecurity`, `cert-in`, `nbfc`, `payment-aggregator`, `zero-trust`, `payout-security`.

Verify a release image:

```bash
cosign verify ghcr.io/peopleofproduct/payrekha:v0.1.0-alpha.0 \
  --certificate-identity-regexp 'https://github.com/peopleofproduct/payrekha/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
gh attestation verify oci://ghcr.io/peopleofproduct/payrekha:v0.1.0-alpha.0 --owner peopleofproduct
```
