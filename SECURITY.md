# Security policy

## Reporting a vulnerability

Email **security@<domain>** with steps to reproduce. Do not open a public issue. You will get an acknowledgement within 3 working days and a fix plan within 10. We credit reporters who want credit.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x (alpha) | Yes, security fixes on the latest alpha |
| < 0.1 | No |

## No telemetry

Payrekha does not phone home. Core and rules make no network calls; CI enforces this. The gateway only calls the endpoints you configure (a SOAR webhook). There is no usage reporting of any kind.

## How Payrekha hardens itself

- Container runs as a non-root user with a read-only root filesystem and all capabilities dropped.
- API and admin bearer tokens are stored as SHA-256 hashes and compared in constant time.
- The caller's origin (`prod`/`nonprod`) and source key come from the authenticated API key, never from the request body.
- Beneficiaries are keyed HMAC hashes at entry; raw identifiers are refused in state and stripped from logs.
- HIGH_ALERT survives restarts and only clears with an authenticated, reasoned reset.
- Releases are signed (cosign keyless), ship a CycloneDX SBOM and SLSA provenance.
