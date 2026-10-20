# 0008. One bilingual app with an EN/FR toggle, French first for v1

Date: 2026-07-15 (PM steer; the toggle was built on 2026-07-17)
Status: Accepted

## Context

Nearly all target users (National Malaria Programme staff) are French-speaking; the first builds
were English only. The PM confirmed French as the main interface language for v1. Options were
separate per-language builds or one app that switches language.

## Decision

- **One webapp with an EN/FR toggle** in the header, not per-language builds.
- Translatable data carries both languages side by side as `{ "en": "…", "fr": "…" }`
  (map `label`s, `pipeline_descriptions.json` values); app chrome lives in an `I18N` table in
  `app.js`. A plain string is still accepted and treated as English.
- Language is resolved at boot from `?lang=` (wins, and is persisted) → `localStorage["snt_lang"]`
  → `en`. Switching re-renders everything; there is no partial-update path.
- Structural fields (`id`, `code`, `type`, `group`, `row`/`col`, `track`, `ohName`) are never
  translated.

## Consequences

- One bundle to deploy and test; a deep link can force a language.
- Every new chrome string and every description edit must be written in **both** languages. Do not
  flatten the `{ en, fr }` shape.
- Parameter labels and help come from the generated catalog and stay English
  ([UI-4](../BACKLOG.md#ui-4)).
- The French copy is a draft until reviewed ([UI-5](../BACKLOG.md#ui-5)).

Sources: `docs/PRODUCT_SPEC.md` §3 and §10 item 1; former `CLAUDE.md` *Bilingual UI*.
