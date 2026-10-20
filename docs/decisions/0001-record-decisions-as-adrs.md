# 0001. Record architecture decisions as ADRs; working plans stay local

Date: 2026-10-19
Status: Accepted

## Context

Until the October 2026 cleanup, the reasons behind this repo's design lived as dated prose inside
`CLAUDE.md` and `README.md` ("since 2026-08-04 …", "noted alternative: …"). That made both files
long, mixed current rules with history, and cost every agent session tokens to read past.
`snt_development` already keeps ADRs in `docs/decisions/` in Nygard format.

Design work is also done with the superpowers skills, which produce specs and implementation plans.
Those are working documents: most of their content is superseded within days.

## Decision

- Durable decisions are recorded as ADRs in `docs/decisions/`, in the same format as
  `snt_development` (no ADR tooling or plugin).
- Docs state current truth only. History lives in git and in ADRs; open items live in
  `docs/BACKLOG.md`.
- Superpowers specs and plans stay in the local, git-ignored `ignore/` folder. A decision from one
  of them is promoted to an ADR once it is settled.

## Consequences

- `CLAUDE.md` can stay short: its rule register links to an ADR for each "why".
- The same ADR format in both repos keeps a future merge of the two (backlog REPO-1) simple.
- Some decisions made before this ADR have no recorded date or full rationale. Their ADRs say
  "not recorded" rather than guess (see [DOC-2](../BACKLOG.md#doc-2)).
- Plans in `ignore/` are not shared. Anything a teammate needs must reach an ADR, a doc or the
  backlog.

Source: `ignore/PLAN.md` §1 (decisions table, 2026-10-19).
