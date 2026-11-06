# Visual briefs — README & docs diagram set

Briefs for generating the dark/light SVG diagram pairs. Follow the same
`<picture>` pattern Panini uses (`<source media="(prefers-color-scheme:
dark)" srcset="…-dark.svg">` + `<img src="…-light.svg">`), so **every asset
ships as a pair**: `-dark` for dark-mode viewers, `-light` for light.

## Shared spec (every asset)

- **Format:** SVG, `viewBox` only (no fixed px width), transparent background
- **Palette:**
  - ink/text — dark variant `#ececf1`, light variant `#1b1b1f`
  - muted — dark `#8f8f9c`, light `#6b6b78`
  - panel fill — dark `#17171d` (stroke `#26262e`), light `#f4f4f7` (stroke `#dddde4`)
  - accent (the rekha / brand) — `#FFB23E` marigold, same in both variants
  - verdicts — ALLOW `#3ecf8e`, REVIEW `#f5c542`, BLOCK `#f0564f`
  - links/info — `#5cc8e0`
- **Type:** `font-family="system-ui, sans-serif"`, labels 13–15px, headers 17–20px
- **Text:** every diagram needs a full `alt`-worthy caption in the README —
  keep SVG text minimal and legible at 640px wide
- **No external refs:** no images, fonts, or imports — pure vector + text

## 1. `payrekha-pipeline-{light,dark}.svg` — the payout path

Horizontal flow, ~1200×420 viewBox:

```
[LOS / recon / approver] ──signs──▶ [signed intent] ──┐
                                                    ▼
[payout caller] ──▶ [Envoy ext_authz] ──▶ [PayRekha] ──verdict──▶ ALLOW → [Bank / NPCI rails]
                                          │                      BLOCK/REVIEW → hold
                                          └──▶ [decision log] ──▶ [SIEM] / [Prometheus]
```

The signed-intent edge and the PayRekha box get the saffron accent. Label
under PayRekha: *"no matching intent, no payout"*. A subtle rekha (accent
rule) between PayRekha and the rails.

## 2. `payrekha-boundary-{light,dark}.svg` — the line that holds

Two lanes, ~1200×380. A bold vertical saffron line labelled **payrekha**
down the middle:

- **Top lane:** `valid key + signed intent →` crosses the line → `₹ reaches
  rails` (green)
- **Bottom lane:** `stolen key + no intent →` hits the line → `✕ money
  stays` (red)
- Small annotation under the blocked lane: *"the credential was real — the
  intent never existed"*

## 3. `payrekha-before-after-{light,dark}.svg` — trust model shift

Two panels, ~1200×400:

- **Before:** attacker with `valid API key` → `payout API` → `money leaves`.
  Caption: *"one question: is this a valid key?"*
- **After:** attacker with `valid API key` → `PayRekha` → held, because no
  intent. Caption: *"two questions: valid key? and was this decided?"*

## 4. `payrekha-ladder-{light,dark}.svg` — adoption staircase

Ascending steps, ~1200×360: **Replay** (Day 1 · laptop) → **Shadow** (W1 ·
observe-only) → **Advise** (W2–3 · verdicts to ops) → **Enforce** (per kind).
Each step labelled "what it can break: nothing" until Enforce ("only what
you turn on"). Rising saffron riser edges.

## 5. `payrekha-stack-{light,dark}.svg` — where it sits in the stack

Layered bands, ~1200×400, top→bottom:

```
[LOS · LMS · settlement engine · withdrawal approver]   ← signs intents
[API gateway · WAF · IAM]                               ← authenticates callers
[── PAYREKHA ──]                                        ← authorizes payouts (accent band)
[Envoy / payout service]
[Bank · NPCI · VDA rails]
```

Caption strip: *"perimeter trusts callers; the band asks if the payout was
decided"*.

## 6. `payrekha-weekend-kit-{light,dark}.svg` — quickstart topology

Cluster boxes, ~1200×380: `payout API` → `Envoy` ⇄ `PayRekha`; `PayRekha` →
`decision log` → `vector` → `SIEM`; `Prometheus` scrapes `PayRekha`; `Grafana`
reads `Prometheus`. Small tag on PayRekha: `mode: shadow`. Compose-file
aesthetic (rounded boxes, dashed "docker-compose" boundary).

## Placement (once generated)

| Asset | Where |
|---|---|
| pipeline | README, right after "What it does, in one breath" |
| boundary | README, in the "name/line" section |
| before-after | README, "The attack it's built for" |
| ladder | README, under the adoption table |
| stack | `docs/threat-model.md` + `playbook-ciso.md` |
| weekend-kit | `docs/weekend-kit.md` + `try-this-weekend.md` |
