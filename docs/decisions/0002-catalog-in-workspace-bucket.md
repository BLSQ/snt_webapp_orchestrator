# 0002. The pipeline catalog lives in the workspace bucket, with no fallback

Date: 2026-08-04 (the boot-time diagnosis was added on 2026-08-05)
Status: Accepted

## Context

The orchestrator needs a per-workspace catalog (`pipeline_cards.json`): which SNT pipelines are
installed, their UUIDs and their parameters. UUIDs and codes differ in every workspace
([0006](0006-node-id-is-python-function-name.md)).

Before this decision the catalog was a repo file per workspace (and per UI variant) under
`workspaces/<ws>/<variant>/`, bundled into the deployed webapp. Every config change — a pipeline
installed, a parameter renamed — therefore needed a repo commit and a webapp redeploy, and the
bundle was no longer the same in every workspace.

## Decision

- The catalog is **not in the repo and not in the bundle**. Each workspace holds its own copy in
  its bucket at `utils_pipelines/create_pipeline_cards/pipeline_cards/pipeline_cards.json`, written
  by the `create_pipeline_cards` pipeline and read by the app at page load
  (`prepareObjectDownload` → `fetch` of the signed URL).
- **There is no fallback catalog.** If the object is missing or unreadable, the app fails at boot
  with a message that diagnoses why (generator not installed, never run, running, last run failed)
  and links to the fix.
- There is no `workspaces/` folder in the repo, and there must not be one.

## Consequences

- A config change is a pipeline run, not a redeploy or commit. The bundle is byte-identical in every
  workspace.
- Every workspace must have the generator installed and run once before its orchestrator boots.
- `FILES_READ` becomes boot-critical for the webapp.
- The bucket key is a runtime contract between `CARDS_OBJECT_KEY` in `webapps/orchestrator/app.js`
  and `OUTPUT_DIR` + `WEBAPP_CARDS_PATH` in `pipelines/create_pipeline_cards/config.py`. It does not
  follow the repo layout; changing it is a migration across every workspace
  ([REPO-3](../BACKLOG.md#repo-3)).
- Each generator run archives the previous catalog under `…/pipeline_cards/historical/`, so changes
  can be diffed.
- A stale bundled copy can never be served silently, but a workspace without a catalog shows an
  error screen instead of a degraded app.

Sources: former `CLAUDE.md` *The pipeline catalog* and *Diagnosing a missing catalog*; former
`README.md` *Where the pipeline catalog comes from*; [`../ARCHITECTURE.md`](../ARCHITECTURE.md#the-pipeline-catalog).
