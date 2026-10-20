# 0009. Cockpit is the only maintained UI; Flowchart is parked

Date: 2026-10-19 (Cockpit became the v1 lead on 2026-07-15, PM steer)
Status: Accepted

## Context

The orchestrator was built as two independently deployable UI variants over the same
functionality: **Cockpit** (a guided, one-step-at-a-time walkthrough) and **Flowchart** (a 2D
node/edge map with a side panel). On 2026-07-15 the PM made Cockpit the v1 lead; Flowchart
continued as a side product that "may follow".

Since then every v1 feature (bilingual UI, report embed, collapsible sections) landed in Cockpit
only, so the variants drifted. Keeping both doubled the docs (variant tables, per-variant slugs,
per-variant line references) and the deploy paths.

## Decision

- The repo is **cockpit-only**: `webapps/orchestrator/` is the one maintained UI.
- Flowchart is parked, unchanged, in `deprecated/flowchart/`, with its spec and roadmap extracted
  to `deprecated/flowchart/SPEC.md` and revival steps in `deprecated/flowchart/README.md`. Since the
  cut-over these live only in the archived predecessor repo
  ([`deprecated/flowchart/`](https://github.com/BLSQ/OpenHEXA-WebApp-Diary/tree/bbd02388f0104d809e55a81f5b84b29ce6b569bd/deprecated/flowchart);
  [ADR 0013](0013-fresh-repo-without-history.md)).

## Consequences

- Docs, contracts and the product spec describe one UI; there is no "variant" wording left.
- Flowchart webapps may still be deployed in some workspaces; the repo does not track them
  ([OPS-1](../BACKLOG.md#ops-1)).
- Whether a 2D map ever becomes user-facing is an open product question, recorded in
  `deprecated/flowchart/README.md`. Reviving it means porting everything Cockpit gained since.
- The node ids of any future second webapp must match `webapps/orchestrator/pipeline_map.json`,
  because one catalog serves every webapp in a workspace.

Sources: `docs/PRODUCT_SPEC.md` §7 and former §10 item 7; `ignore/PLAN.md` §1.
