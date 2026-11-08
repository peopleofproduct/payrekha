# Security policy

## Reporting a vulnerability

Email **security@<domain>** with steps to reproduce. Do not open a public issue.

**Response SLA**: acknowledgement within **3 working days**, a severity assessment + fix plan within **10 working days**, a shipped fix or a documented mitigation within **30 days** for HIGH+ (CRIT aims for 7 days). We coordinate disclosure with you — you get credited (or stay anonymous, your call) in the advisory. We do not sue researchers acting in good faith.

## How advisories work

Security fixes ship as GitHub Security Advisories on the repo — CVE requested for anything HIGH+ — plus a release-note section naming the affected versions, the fixed version, and the mitigation if you can't upgrade today. The first security release through this pipeline is a required GA gate (E3/G6), not a hope.

## Supported versions

| Version | Supported | Until |
|---|---|---|
| 0.1.x (alpha) | Yes — security fixes on the latest alpha tag | superseded by 0.2/1.0 |
| 1.x (once GA) | Latest minor + previous minor | previous minor drops 90 days after the next ships |
| < 0.1 | No | — |

## Semver & deprecation contract (effective at 1.0; alpha already follows it)

- **API**: additive or versioned — a breaking request/response change means a new route version (`/v2/…`), never a silent shape change under `/v1`.
- **Config keys**: deprecations live ≥ 1 minor — the key keeps working with a boot warning before it errors.
- **Snapshot format**: `version` bumps ship code migrations (`docs/upgrades.md`) — restoring an older snapshot on a newer binary always works; newer-on-older fails closed.
- **Data on disk** (decision log, envelope): appended fields only; field removal follows the ≥1-minor rule.
- **Beta/alpha tags** may break any of the above, loudly, in release notes — GA is the promise not to.

## No telemetry

PayRekha does not phone home. Core and rules make no network calls; CI enforces this. The gateway only calls the endpoints you configure (a SOAR webhook). There is no usage reporting of any kind.

## How PayRekha hardens itself

- Container runs as a non-root user with a read-only root filesystem and all capabilities dropped.
- API and admin bearer tokens are stored as SHA-256 hashes and compared in constant time.
- The caller's origin (`prod`/`nonprod`) and source key come from the authenticated API key, never from the request body.
- Beneficiaries are keyed HMAC hashes at entry; raw identifiers are refused in state and stripped from logs.
- HIGH_ALERT survives restarts and only clears with an authenticated, reasoned reset.
- Releases are signed (cosign keyless), ship a CycloneDX SBOM and SLSA provenance.
