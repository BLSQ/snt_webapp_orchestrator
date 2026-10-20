# create_pipeline_cards

An OpenHEXA pipeline that generates a workspace's `pipeline_cards.json` for the SNT Pipelines
Orchestrator, straight from live data — no manual GitHub scraping needed.

This is a **utility pipeline that supports the orchestrator webapp**, not one of the ~18 SNT
process pipelines the orchestrator lets users run (those live in the separate
[`snt_development`](https://github.com/BLSQ/snt_development) repo). It belongs in
`pipelines/` alongside any future pipelines that support the webapp itself.

## What it does

For the workspace it runs in, it:

1. Lists every pipeline currently deployed in the workspace (`hexa_client.pipelines`).
2. For each one, resolves its current version and reads its deployed `pipeline.py` source to
   extract the `@pipeline("...")` id — the stable Python function name used as the node `id` in
   `webapps/orchestrator/pipeline_map.json`.
3. Curates the list down to only the pipelines that are actual nodes of the orchestrator
   webapp's deployed `pipeline_map.json` (which webapp: see `config.WEBAPP_SLUG` below).
   Pipelines with no resolvable id, or not present in the map, are excluded and logged; map
   nodes with no matching pipeline are logged too (they'll render greyed-out in the
   orchestrator).
4. Fetches each kept pipeline's current parameters and formats them to the shape the orchestrator
   webapp expects (parameter `type` values are mapped from OpenHEXA's connection types, e.g.
   `dhis2` → `DHIS2Connection`), and records **which deployed version** they were read from
   (`version_name` / `version_number`).
5. Archives any previously generated file into a `historical/` subfolder (timestamped), then
   writes the new `pipeline_cards.json` to the pipeline's output directory in the workspace's
   file storage.

The output matches the contract in `contracts/pipeline_cards.schema.json`. **It is consumed in place:**
the orchestrator webapp fetches it straight out of the workspace's file storage at page load, so
running this pipeline is all that's needed to update a workspace's configuration — nothing to copy,
commit, or redeploy. The full picture is in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#the-pipeline-catalog);
the reasons in ADRs [0002](../../docs/decisions/0002-catalog-in-workspace-bucket.md) (catalog in the
bucket), [0003](../../docs/decisions/0003-catalog-parameters-from-deployed-version.md) (parameters
from the deployed version) and [0004](../../docs/decisions/0004-generator-curates-against-deployed-map.md)
(curation against the deployed map).

Each card also records the **deployed version** its parameters were read from (`version_name`,
`version_number`). The orchestrator does not read them yet ([UI-8](../../docs/BACKLOG.md#ui-8)).

## Parameters

**None.** The pipeline takes no parameters — just run it. Everything it needs it derives from the
workspace it runs in (`workspace.slug`) plus the constants in `config.py`.

The webapp to curate against is identified by a slug constant:

```python
# config.py
WEBAPP_SLUG = "snt-pipelines-orchestrator-cockpit"
```

- This is the orchestrator webapp whose **deployed** `pipeline_map.json` is the curation authority.
- ⚠️ **That webapp must exist in the workspace, or the run fails** with `Failed to read
  pipeline_map.json from webapp '…'`. There is no uncurated fallback — a run either
  curates against a real deployed map or stops. This is deliberate: silently emitting every
  pipeline in the workspace is worse than a clear failure.
- If a workspace's orchestrator has a different slug, edit `WEBAPP_SLUG` and redeploy the
  pipeline. **Look the slug up live** with `list_static_webapps` — webapp slugs are editable per
  workspace.

## Output

Written to `<workspace files>/utils_pipelines/create_pipeline_cards/pipeline_cards/pipeline_cards.json`
(see `config.OUTPUT_DIR` / `config.WEBAPP_CARDS_PATH`). The previous file, if any, is moved to a
`historical/` subfolder first (e.g. `pipeline_cards_20260803_101500.json`) so nothing is
overwritten silently.

**This path is a contract with the webapp** — a bucket key, not a repo path (it does not follow
where this folder lives in the repo). The webapp hardcodes it as `CARDS_OBJECT_KEY` in
`webapps/orchestrator/app.js` and reads the file via `prepareObjectDownload` → `fetch(signedUrl)` (needing
the webapp's `FILES_READ` scope). Changing `OUTPUT_DIR` or `WEBAPP_CARDS_PATH` therefore means
changing `CARDS_OBJECT_KEY` and redeploying the webapp — otherwise every orchestrator
in every workspace stops booting.

Nothing needs to be downloaded, committed, or redeployed after a run: the app reads the new file on
its next page load. The pipeline does not push to the repo or touch the webapp bundle.

## Files

- `pipeline.py` — the pipeline itself (`create_pipeline_cards`).
- `config.py` — GraphQL queries, the parameter type map, output paths, and other constants.
  `WEBAPP_SLUG` is the one you are most likely to need to change (see _Parameters_).
- `.gitignore` — ignores the local OpenHEXA SDK scaffolding (`workspace/`, `workspace.yaml`,
  `.vscode/`, `__pycache__/`) created when running/debugging the pipeline locally.

## Caveats

- Pipeline **ids** are derived by regex-matching `@pipeline("...")` in the deployed
  `pipeline.py` source. A pipeline with no deployed version, no `pipeline.py` in its file
  listing (e.g. notebook-based pipelines), or a missing/malformed decorator will have `id: null`
  and be excluded by curation.
- The run **fails** if the webapp named by `config.WEBAPP_SLUG` isn't deployed in the workspace,
  since its map is the curation authority. When standing up a new workspace: deploy the
  orchestrator first, then run the generator.
- Duplicate `@pipeline` ids across workspace pipelines are logged as warnings but not resolved
  automatically — deprecated duplicates should be cleaned up in the workspace.
- `config.EXPECTED_NUM_PIPELINES` (currently `18`) is only used to log a warning if the curated
  count doesn't match — it does not fail the run (so it always warns in a workspace that has only
  a subset of the pipelines installed).
- Each catalog carries a `_notes` string built from `config.NOTES` with the workspace slug filled in.

## Reference: how an SNT pipeline declares its parameters

The generator reads parameters from the deployed version through the API, so you should not need
this — except to read pipeline source on GitHub, or to diagnose a pipeline that comes out with
`id: null`.

Source: `https://raw.githubusercontent.com/BLSQ/snt_development/main/{pipeline_id}/pipeline.py` —
each pipeline is a folder at the **root** of `snt_development` named after its Python function name
(not under its `pipelines/` folder). The `id` is the first argument of `@pipeline("...")`.

Parameters are `@parameter` decorators stacked above the function; top-to-bottom is the display
order. Each maps to one entry of the card's `parameters` array:

```python
@parameter(
    "param_key",            # → "key"
    name="Display Label",   # → "label"
    help="Help text",       # → "help"
    type=bool,              # → "type"
    default=True,           # → "default"  (omitted if None)
    required=False,         # → "required" (omitted if False)
    choices=["a", "b"],     # → "choices"  (omitted if absent; for (value, label) tuples keep the value)
)
```

Python types `bool`, `int`, `float`, `str`, `File` map to the same names. Connection parameters
reach the generator as OpenHEXA's lowercase codes (`dhis2`, `custom`, `iaso`, `postgresql`, `gcs`,
`s3`, `file`) and are mapped by `PARAMETER_TYPE_MAP` in `config.py` to `DHIS2Connection`,
`CustomConnection`, `IASOConnection`, `PostgreSQLConnection`, `GCSConnection`, `S3Connection`,
`File`. The contract is [`contracts/pipeline_cards.schema.json`](../../contracts/pipeline_cards.schema.json).
