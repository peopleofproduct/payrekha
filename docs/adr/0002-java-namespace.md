# ADR 0002 — Java package namespace: `city.theproduct.payrekha`

- Status: accepted, with one reopening trigger
- Date: 2026-11-06

## Context

The Java client (`clients/java`) sits under `city.theproduct.payrekha`, a package namespace derived from `theproduct.city`, a domain the org already controls. Maven Central (and most enterprise artifact proxies) require the `groupId` to be a domain the publisher can prove control over — verified via a DNS TXT record or repo-hosting link at publish time.

PayRekha is positioned as "a Panini Tech project by People of Product". If PayRekha later gets its own domain or legal entity, a vendor-namespace artifact reads slightly off — and **renaming a package after a stable release is a breaking change**: every `import city.theproduct.payrekha.*` in consumer code must change.

The window where a rename is free is *now* — the client is alpha and published nowhere yet (no Maven Central release exists; consumers at most compile from source).

## Options considered

| Namespace | Ownership proof | Notes |
|---|---|---|
| `city.theproduct.payrekha` | Already verifiable today | Vendor namespace — like `com.acme.product`. Consistent with the PoP family. Costs nothing. |
| `dev.payrekha` / `io.payrekha` | Requires registering a `payrekha` domain (~₹1–3k/yr) and keeping it forever | Cleanest product brand for BFSI evaluators. If the domain ever lapses, the groupId claim lapses with it. |
| `io.github.peopleofproduct` | Free via GitHub verification | Brands the artifact to the org account, not the product. No better than the status quo. |

## Decision

Keep `city.theproduct.payrekha`.

- It is verifiable today — the first Maven Central upload could happen without buying anything.
- The vendor namespace is honest: People of Product is the publisher regardless of future product branding (compare `com.fasterxml` for `jackson` — nobody reads it as a domain problem).
- The remaining risk is only aesthetic, and only materialises if a `payrekha` domain/entity actually arrives.

**Reopening trigger:** if a `payrekha` domain is registered before the first **stable** (non-alpha/beta) release, rename then — that is the last cheap window. The rename touches `clients/java/**` package declarations, the directory layout, the README/docs snippets, and the build script. Once `1.x` exists with the old namespace, it stays forever.

## Consequences

- Maven Central publishing can proceed under `city.theproduct` groupId whenever the client stabilises.
- The release checklist gains one line: *"pre-1.0 only — if a payrekha domain exists by then, revisit ADR 0002 before tagging."*
