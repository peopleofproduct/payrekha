# Advisory review — template & process

How a new CERT-In / BFSI advisory becomes code or a documented exclusion.
This is the process that produced `advisory-review-ciad-2026-0058.md` —
run it identically every time so reviews are comparable.

## Turnaround targets

| Stage | Target |
|---|---|
| Acknowledge + scope the advisory | 2 business days |
| Line-by-line review doc committed | 5 business days |
| Gap list → roadmap items (or explicit exclusions) | same PR as the review |
| In-scope controls implemented | next release train — stated per gap |
| Public advisory page updated (mapping + score) | with the implementing release |

## The review doc — required sections

```markdown
# Advisory review: <ADVISORY-ID> (<codename>)

## 1. Advisory facts
   Issuer, date, affected sectors, recommended-actions count, canonical link.

## 2. Scope decision — what a payout firewall can even address
   Which recommended actions concern money moving through APIs (in scope),
   which are endpoint/cloud/organizational (out of scope by architecture).

## 3. Line-by-line table
   | Advisory row | Verbatim requirement | Status | Evidence |
   Status ∈ {COVERED, PARTIAL, GAP, OUT-OF-SCOPE(product), OUT-OF-SCOPE(operator), EXCLUDED}
   Evidence = code path + test + doc, never prose. Every PARTIAL names
   the missing half and its roadmap item.

## 4. The exclusions list — written, named, owned
   Each exclusion: what it is, why it's not a payout-firewall concern,
   and who owns it (operator / cloud provider / org function).

## 5. Score
   In-scope coverage %, separate from the raw row count — a firewall is
   not scored on the entity's endpoint estate.

## 6. Gap plan
   Each gap → roadmap item id (A/B/C/D/E), effort, acceptance criterion.
```

## Standing rules

- **Never claim** infrastructure or organizational controls as product
  coverage — that row is an exclusion with a named owner, not a gap.
- **Update `advisory-mapping.md`** in the same PR — it's the public
  feature table; the review is the private analysis.
- A review that produces **zero gaps** still documents the analysis —
  "we checked, we're covered, here's the line-by-line" is the artifact
  auditors ask for.
- Findings that can't be fixed in-product get an operator-runbook
  mitigation before the review closes (e.g. the failure-modes rows that
  end "your network policy must…").
