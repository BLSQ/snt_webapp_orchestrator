# 0004. The generator curates against the deployed orchestrator map

Date: not recorded (in place by 2026-08-04)
Status: Accepted

## Context

A workspace holds more pipelines than the SNT process map: utility pipelines, duplicates,
experiments. The catalog should list only pipelines that are nodes of the orchestrator's map. The
generator therefore needs an authoritative list of node ids. Candidates were the repo copy of
`pipeline_map.json`, a parameter naming the webapp, or the map actually deployed in the workspace.

The generator once took a `webapp_name` parameter; the date it was removed is recorded only as
"2026-08-04" in the old README.

## Decision

- `create_pipeline_cards` takes **no parameters**. It reads the `pipeline_map.json` **deployed** in
  the webapp named by `config.WEBAPP_SLUG` (`snt-pipelines-orchestrator-cockpit`) and keeps only the
  pipelines whose `@pipeline` id is a node of that map.
- If that webapp is not deployed in the workspace, the run **fails**. There is no uncurated
  fallback.

## Consequences

- The catalog always agrees with the map the user actually sees, even if the repo has moved on.
- Order matters when standing up a workspace: **deploy the orchestrator first, then run the
  generator.**
- A workspace whose orchestrator has a different slug needs `WEBAPP_SLUG` edited and the generator
  redeployed. Webapp slugs are editable, so look the slug up live.
- Map nodes with no matching pipeline are logged and render greyed in the app; pipelines with no
  resolvable id are excluded.

Sources: [`pipelines/create_pipeline_cards/README.md`](../../pipelines/create_pipeline_cards/README.md)
*Parameters*; former `CLAUDE.md` *The pipeline catalog*.
