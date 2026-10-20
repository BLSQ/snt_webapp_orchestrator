# `docs/decisions/` — architecture decision records

One file per decision that shapes how this repository works, so the *why* survives after the people
who made it move on. Format after Michael Nygard's
[ADR template](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions), as in
`snt_development`'s `docs/decisions/`.

- An ADR records a decision **and its reasoning**. The rule itself lives where people apply it
  (`CLAUDE.md`'s rule register, `webapps/orchestrator/CLAUDE.md`, a contract, a pipeline README); the
  ADR is what that rule links to for "why".
- **Never edit an accepted ADR to change the decision.** Write a new one and mark the old one
  `Superseded by NNNN`. Fixing a typo or a link is fine.
- Open questions do not belong here: they go to [`../BACKLOG.md`](../BACKLOG.md). When a backlog
  item is settled by a decision, delete it there and write the ADR here.
- Where the original date or reason was never written down, the ADR says so. Do not fill the gap
  with a plausible guess.
- Working specs and implementation plans (e.g. from the superpowers skills) live in the local,
  git-ignored `ignore/` folder. Once a decision in one of them is settled and durable, promote it to
  an ADR here.

## Index

| # | Title | Status | Date |
|---|---|---|---|
| [0001](0001-record-decisions-as-adrs.md) | Record architecture decisions as ADRs; working plans stay local | Accepted | 2026-10-19 |
| [0002](0002-catalog-in-workspace-bucket.md) | The pipeline catalog lives in the workspace bucket, with no fallback | Accepted | 2026-08-04 |
| [0003](0003-catalog-parameters-from-deployed-version.md) | Catalog parameters come from the deployed pipeline version, not GitHub | Accepted | 2026-08-04 |
| [0004](0004-generator-curates-against-deployed-map.md) | The generator curates against the deployed orchestrator map | Accepted | not recorded |
| [0005](0005-catalog-not-in-workspace-configuration.md) | The catalog is not stored in `workspace.configuration` | Accepted | not recorded |
| [0006](0006-node-id-is-python-function-name.md) | The node `id` (Python function name) is the only cross-workspace key | Accepted | not recorded |
| [0007](0007-multi-file-bundle-no-build.md) | A flat multi-file bundle: no build step, no CDN, no layout library | Accepted | not recorded |
| [0008](0008-one-bilingual-app.md) | One bilingual app with an EN/FR toggle, French first for v1 | Accepted | 2026-07-15 |
| [0009](0009-cockpit-only-flowchart-parked.md) | Cockpit is the only maintained UI; Flowchart is parked | Accepted | 2026-10-19 |
| [0010](0010-hardcoded-saas-front-end-base.md) | The SaaS front-end base `app.openhexa.org` is hardcoded | Accepted | not recorded |
| [0011](0011-repo-is-not-a-deployment-record.md) | The repo is the reference source, not a deployment record | Accepted | 2026-10-19 |
| [0012](0012-one-folder-per-deployable-unit.md) | One self-contained folder per deployable unit | Accepted | 2026-10-19 |
| [0013](0013-fresh-repo-without-history.md) | A fresh public repo from one snapshot; history and `deprecated/` stay in the archived repo | Accepted | 2026-10-20 |

## Template

Copy this into `NNNN-short-title.md`, with the next free number. Keep it short (about 40 lines).

```markdown
# NNNN. Title

Date: YYYY-MM-DD
Status: Proposed | Accepted | Superseded by NNNN | Deprecated

## Context

What forced a decision, and the constraints at the time.

## Decision

What was decided, stated as a rule.

## Consequences

What follows — the good, the costs, and what to watch for.
```

Then add a row to the index above.
