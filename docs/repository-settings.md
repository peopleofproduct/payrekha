# Repository settings

Payrekha asks operators to protect their payout path; the repository holds itself to the same bar (CIAD-2026-0058 also asks for signed commits and protected branches).

- **Branch protection on `main`:** require pull requests, 1 approving review (2 for `packages/core` and `packages/rules` via CODEOWNERS), dismiss stale approvals, require status checks `build-test (22)`, `build-test (24)`, `java-client`, `python-client`, `docker`, `secrets`; no force-push, no deletion; include administrators.
- **Signed commits:** require signed commits on `main`.
- **Secret scanning:** enable GitHub secret scanning and push protection; `gitleaks` also runs in CI.
- **Actions:** default `GITHUB_TOKEN` permissions read-only; release workflow requests `id-token: write` only for keyless signing and attestations. All third-party actions are pinned to a commit SHA (the `uses:` comment records the version tag); Dependabot updates the pins.
- **Releases:** tags `v*` only from `main`; npm publish uses `--provenance`; images are signed with cosign and carry SLSA provenance and a CycloneDX SBOM.
- **Dependabot:** enabled for npm, GitHub Actions, Docker, the Go client and the Python client (`.github/dependabot.yml`).

Verify a release image:

```bash
cosign verify ghcr.io/peopleofproduct/payrekha:v0.1.0-alpha.0 \
  --certificate-identity-regexp 'https://github.com/peopleofproduct/payrekha/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
gh attestation verify oci://ghcr.io/peopleofproduct/payrekha:v0.1.0-alpha.0 --owner peopleofproduct
```
