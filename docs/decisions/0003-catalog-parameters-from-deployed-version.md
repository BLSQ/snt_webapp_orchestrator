# 0003. Catalog parameters come from the deployed pipeline version, not GitHub

Date: 2026-08-04
Status: Accepted

## Context

The parameter form in the orchestrator is generated from each pipeline's `parameters` in the
catalog. Those used to be scraped from the pipeline source on GitHub `main`
(`snt_development/<pipeline_id>/pipeline.py`). A workspace can run an older version than `main`, so
the form could offer parameters the installed pipeline did not accept, and a run would be rejected
(`INVALID_CONFIG`).

## Decision

`create_pipeline_cards` reads parameters from the pipeline version **deployed in that workspace**
(`pipelineByCode.currentVersion.parameters`) and records the source as
`parameters_source: "openhexa_deployed"`. Each card also records the version it was read from
(`version_name`, `version_number`).

## Consequences

- The form matches what is installed when the generator ran. The GitHub-vs-installed drift class is
  gone for parameters.
- What can still drift is the catalog vs the workspace *now*: a pipeline upgraded after the last
  generator run. The fix is always to re-run the generator, never to hand-edit the catalog.
- The pipeline README link in the app still points at GitHub `main`, so documentation can still
  drift from the installed version (a separate, open question: [UI-6](../BACKLOG.md#ui-6)).
- `version_name` / `version_number` are not read by the app yet; they exist for a future drift
  check ([UI-8](../BACKLOG.md#ui-8)).
- Parameter labels and help text are English, because they come from pipeline source
  ([UI-4](../BACKLOG.md#ui-4)).

Sources: former `CLAUDE.md` *Staleness*; `contracts/pipeline_cards.schema.json`;
[`pipelines/create_pipeline_cards/README.md`](../../pipelines/create_pipeline_cards/README.md).
