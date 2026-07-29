---
name: compliance-check
description:
  'Audit user-facing copy, mock data, or marketing content for real-estate compliance — Fair Housing
  steering language, Real Broker LLC brand prominence, fabricated-data labeling, and
  Sponsored/Featured disclosure. Use before shipping any listing copy, marketing text, mock data, or
  Connect/Services content. Usage: /compliance-check [path or "recent changes"]'
---

# Real Estate Compliance Check

Audit the target content (`$ARGUMENTS` — a path or scope; if empty, the current session's changed
files) against the platform's compliance rules. Authoritative sources: `PRD.md` §6 (brand/MLS/Fair
Housing/privacy), §4.6 (cross-tab guardrails), §5.9 (Services compliance).

## 1. Fair Housing (FHA) — no steering, no preference language

Grep the target for steering/preference phrases and judge each hit in context. Flag language
expressing or implying preference based on race, color, religion, sex, familial status, national
origin, or disability. Known red-flag phrases (non-exhaustive — judge intent, not just keywords):

- "safe neighborhood", "low crime", "good/bad area", "desirable neighborhood"
- "great for families", "family-friendly", "perfect for young professionals", "empty nesters",
  "bachelor pad", "ideal for couples"
- "exclusive community", "private community" (in a who-belongs sense), "upscale clientele"
- "walking distance to [church/temple/mosque]" (religious steering), ethnicity-coded area praise
- "no kids", "adults only", "perfect for singles"
- School-quality superlatives used as neighborhood praise ("top schools" is high-risk steering)

Objective property facts are fine ("3 beds", "0.2 mi to Metro", "built 2015"). Describe the
property, never the people who should live there.

## 2. Brand prominence (Bright MLS rule)

- **Real Broker, LLC** must be the most prominent brand; **Cribstop** secondary.
- Licensure claims must match MD / DC / VA only.
- Web client: brand strings come from `apps/clients/cribstop/next/src/lib/brand.ts` — flag any
  hardcoded brand text elsewhere.
- Every listing render (cards, detail, Connect feed embeds) carries broker/office attribution.
- Internal/FSBO listings must never be presented as MLS-sourced (`source` field integrity).

## 3. Fabricated data

- No fabricated prices, sold figures, rates, reviews, testimonials, or view counts presented as
  real. Mock/sample data must be clearly labeled ("Demo"/"Sample").
- Check mock data files (e.g., `src/lib/listings.ts`) for realistic-looking records tagged
  `source: 'brightMLS'` without sample labeling.

## 4. Disclosure & consent

- Paid/featured provider placement must carry a visible "Sponsored"/"Featured" label — never
  presented as organic ranking (PRD §4.6, FTC).
- Referral/affiliated-business relationships disclosed (RESPA).
- Email/SMS copy: opt-in basis and unsubscribe path present (TCPA/CAN-SPAM).
- Verified Resident info renders at neighborhood level only — never a street address (PRD §3.2).

## Output

Report as a table: file:line · quoted text · rule violated · suggested compliant rewrite. End with
PASS (no violations) or FAIL (violations listed). Severity: FHA violations and
fabricated-data-as-real are blockers; missing labels/attribution are must-fix-before-ship.
