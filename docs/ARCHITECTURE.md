# Architecture — SNT Pipelines Orchestrator

How the orchestrator webapp and its catalog generator fit together. The portable OpenHEXA know-how
(proxy, scopes, queries) is in [`OPENHEXA_WEBAPP_RUNTIME.md`](OPENHEXA_WEBAPP_RUNTIME.md); app-code
rules are in [`webapps/orchestrator/CLAUDE.md`](../webapps/orchestrator/CLAUDE.md); the *why* behind
each choice is in [`decisions/`](decisions/README.md). SNT terms: see `snt_development`'s
[`docs/GLOSSARY.md`](https://github.com/BLSQ/snt_development/blob/main/docs/GLOSSARY.md).

## Overview

One static webapp per workspace presents the **complete** set of official SNT pipelines (18 map
nodes, from the `snt_development` repo) as a guided, one-step-at-a-time walkthrough with a
configuration/run panel. **The map is identical in every workspace**; what differs per workspace is
only which nodes are *available* — pipelines not installed there render greyed-out and unclickable.

```
IN THIS REPO — deployed as-is, identical in every workspace
  webapps/orchestrator/  index.html · styles.css · app.js · pipeline_map.json · pipeline_descriptions.json
        │  deploy (MCP / OpenHEXA UI)
        ▼
  OpenHEXA static webapp ──── reads at page load via a signed URL (FILES_READ) ───┐
                                                                                  │
IN EACH WORKSPACE — generated, never in the repo                                  │
  pipelines/create_pipeline_cards/ (repo folder) → pushed and run as a pipeline   │
        ▼                                                                         │
  bucket: utils_pipelines/create_pipeline_cards/pipeline_cards/pipeline_cards.json ┘
```

## Data architecture

The stable join key everywhere is the node `id` == the pipeline's Python function name (e.g.
`snt_dhis2_extract`) — [ADR 0006](decisions/0006-node-id-is-python-function-name.md). Pipeline
UUIDs and codes differ per workspace and are only ever read at runtime from that workspace's own
catalog.

| File | Scope | Holds | Contract |
|---|---|---|---|
| `webapps/orchestrator/pipeline_map.json` | bundle (all workspaces) | nodes (`id`, `code`, bilingual `label`, `ohName`, stage `row`, `track`, `type`, mutex `group`) + directed `edges` | [`pipeline_map.schema.json`](../contracts/pipeline_map.schema.json) |
| `webapps/orchestrator/pipeline_descriptions.json` | bundle | hand-authored Markdown-lite description per node, keyed by `id`, as `{ en, fr }` | [`pipeline_descriptions.schema.json`](../contracts/pipeline_descriptions.schema.json) |
| `pipeline_cards.json` — **in the workspace bucket, not the repo** | per workspace | which pipelines exist + `uuid` + `parameters` + source version | [`pipeline_cards.schema.json`](../contracts/pipeline_cards.schema.json) |
| `webapps/orchestrator/index.html` + `app.js` + `styles.css` | bundle | the app shell: merges map + descriptions with the catalog, runs and polls pipelines | — |

The map and descriptions are **hand-authored**, not generated from the API.
`design/pipeline_map_preview.html` renders the map for review.

### The bundle is workspace-independent

The deployed bundle is the five files in `webapps/orchestrator/`, flat, with nothing
workspace-specific ([ADR 0007](decisions/0007-multi-file-bundle-no-build.md)). The app adapts at
runtime: `window.OPENHEXA.workspaceSlug` drives every query and the catalog read, and the catalog
drives which nodes are greyed. The only platform assumptions baked into `app.js` are the SaaS
front-end base `https://app.openhexa.org` ([ADR 0010](decisions/0010-hardcoded-saas-front-end-base.md))
and the generator template's display name (`GENERATOR_TEMPLATE_NAME`). `app.js` fetches the two
bundled JSON files as same-origin siblings.

## The pipeline catalog

Why it lives where it does: [ADR 0002](decisions/0002-catalog-in-workspace-bucket.md),
[0003](decisions/0003-catalog-parameters-from-deployed-version.md),
[0004](decisions/0004-generator-curates-against-deployed-map.md),
[0005](decisions/0005-catalog-not-in-workspace-configuration.md). How the generator works:
[`pipelines/create_pipeline_cards/README.md`](../pipelines/create_pipeline_cards/README.md).

**Location.** Each workspace's catalog is at the fixed **bucket key**

```
utils_pipelines/create_pipeline_cards/pipeline_cards/pipeline_cards.json
```

written by `create_pipeline_cards`, which archives the previous file under `…/historical/` with a
timestamp on every run.

**How the app reads it** (`loadCards()` in `app.js`):

1. `prepareObjectDownload(input: {workspaceSlug, objectKey: CARDS_OBJECT_KEY, forceAttachment: false})`
   through the `/graphql/` proxy → a signed GCS URL. Needs **`FILES_READ`**.
2. `fetch(signedUrl)` → `.json()`. Works because these signed URLs are CORS-open.

**Rules that follow:**

- ⚠️ **Bucket key ≠ repo path.** `CARDS_OBJECT_KEY` in `app.js` must stay in lockstep with
  `OUTPUT_DIR` + `WEBAPP_CARDS_PATH` in `pipelines/create_pipeline_cards/config.py`. The
  `utils_pipelines/…` prefix is a runtime path in every bucket and does not follow the repo layout.
  Changing it means changing both places, redeploying both, and re-running the generator in every
  workspace — otherwise every deployed app fails at boot.
- **No fallback.** A missing or unreadable catalog fails the boot with a diagnosis (below), never a
  stale bundled copy.
- **Order of setup:** the generator curates against the *deployed* map of the webapp named by
  `config.WEBAPP_SLUG` and fails if that webapp is absent — so deploy the orchestrator first, then
  run the generator.
- **Regenerate, never hand-edit.** A newly installed pipeline, a renamed parameter, a greyed node
  that should be live, a run rejected for drift: the fix is always to run `create_pipeline_cards`
  in that workspace. A hand-patched catalog is silently reverted by the next run. The app picks the
  new catalog up on its next page load.

**Staleness.** Parameters are read from each pipeline's deployed current version
(`parameters_source: "openhexa_deployed"`), so the catalog matches what was installed when the
generator ran; `generated_at` says when that was. What can be stale is the catalog vs the
workspace *now*. Each card also records `version_name` / `version_number`; nothing reads them yet
([UI-8](BACKLOG.md#ui-8)).

### Diagnosing a missing catalog

When `loadCards()` cannot read the catalog, the app runs one extra `pipelines(workspaceSlug:)`
query (no scope beyond `PIPELINES_READ`), finds the generator, and shows a message with a deep
link:

| Diagnosis | What the app tells the user |
|---|---|
| `notInstalled` | install the generator → link to its **template** page |
| `neverRun` | open the pipeline page and press Run |
| `inProgress` | a run is `queued` / `running` / `terminating` — wait; link to it |
| `lastRunFailed` | link straight to the failed run's logs |
| `unknown` | the generic "run `create_pipeline_cards`" text |

The generator's `code` and `name` vary by how it was installed (`create-pipeline-cards`,
`create_pipeline_cards`, `Create pipeline_cards.json`), so it is matched by a normalised key, never
a hardcoded code. Implementation notes: [`webapps/orchestrator/CLAUDE.md`](../webapps/orchestrator/CLAUDE.md#catalog-diagnosis).

### Run errors that mean catalog drift

`runPipeline` returns error **codes** (`PipelineError` enum), which the app translates. Four of
them mean the catalog no longer matches the installed pipeline — `INVALID_CONFIG`,
`PIPELINE_DOES_NOT_SUPPORT_PARAMETERS`, `PIPELINE_NOT_FOUND`, `PIPELINE_VERSION_NOT_FOUND` — and
for those the app adds a "refresh the catalogue" line linking to the generator (reusing the
diagnosis above). See [`OPENHEXA_WEBAPP_RUNTIME.md`](OPENHEXA_WEBAPP_RUNTIME.md#run-errors-are-an-enum)
for the enum.

## Node states

Three independent axes per node:

- **available vs greyed** — static: available iff the node's `id` is in the workspace's catalog
  with a `uuid`. Otherwise greyed and unclickable, with a "how to install" panel linking to the
  templates page.
- **completed** — the pipeline's **most recent run in the workspace** succeeded, read from the
  cross-session status board (`cockpitState(node) === "ok"`). Not limited to runs started in this
  session.
- **locked vs unlocked** — dynamic, from `edges`. A node unlocks once every **hard** prerequisite
  (an edge whose `to` is this node and whose `type` is `"solid"` or omitted) is completed.
  `type: "optional"` edges are soft: listed as "uses if available", never gating (the downstream
  pipeline falls back to a parameter). If run status is unavailable (opened outside OpenHEXA, or the
  status query failed) nothing is locked, so the walkthrough stays explorable.

**Group-aware unlock.** When several hard prerequisites of a node belong to the same alternative
`group`, they count as one: bucket the solid sources of node `N` by `group` (a source with no group
is its own bucket) and require **at least one completed source per bucket** (`lockedReason()`).
The current map has no solid edge leaving a group, so this rule is dormant — but any future one
must honour it rather than require all members.

**Mutual exclusion.** `type: "alternative"` nodes sharing a `group` are mutually exclusive; the
member with the most recent successful run is "in use" and the others are shown as superseded
(`computeGroupInUse()`). Data-driven via `group` — today the A.3 outlier-imputation and A.4
reporting-rate groups. Only a *succeeding* run moves the "in use" mark.

## Map format

Order and dependencies are explicit; there is no graph-layout library
([ADR 0007](decisions/0007-multi-file-bundle-no-build.md)). Field-level docs:
[`contracts/pipeline_map.schema.json`](../contracts/pipeline_map.schema.json).

- The **array order of `nodes` is the walkthrough order**; an alternative group becomes one
  "choose one" step at its first member. `row` is the stage (0 = Extract … 4 = Outputs), `track` the
  data track (A — DHIS2, B — WorldPop & MAP, C — DHS, D — ERA5). `col` is a leftover coordinate the
  app does not read.
- `edges` is a list of `{from, to, type}` objects over node ids. They drive each step's Requires /
  Unlocks / Uses-if-available lists and the locking above.
- Dependencies are expressed **only** as `edges` — no per-node prerequisite array, no layout array.
  An edge out of an alternative group is written once per member.
- **Outputs are not in the map or the catalog.** They are fetched from `pipelineRun.outputs` after
  a run.

## Bilingual UI (EN / FR)

One app with a language toggle ([ADR 0008](decisions/0008-one-bilingual-app.md)). French is the main
interface language for v1.

| Text | Source | Mechanism |
|---|---|---|
| App chrome (buttons, statuses, headings) | `I18N` table in `webapps/orchestrator/app.js` | `t("key", {params})` |
| Node / step titles | `pipeline_map.json` → `label` | `pickLang(label)` |
| Node descriptions | `pipeline_descriptions.json` → `{ en, fr }` | `pickLang(desc)` |
| Parameter labels / help / choices | the workspace's catalog | not translated — English ([UI-4](BACKLOG.md#ui-4)) |

Code-level rules (both `I18N` tables, `pickLang` fallbacks, language resolution order):
[`webapps/orchestrator/CLAUDE.md`](../webapps/orchestrator/CLAUDE.md#bilingual-text).

## Run outputs and the report embed

After a run the app shows its output datasets and files from `pipelineRun.outputs` /
`datasetVersions`. A run's HTML report renders **inline** in an `<iframe>` on a freshly signed GCS
URL, re-signed on demand because signed URLs expire. The technique is in
[`OPENHEXA_WEBAPP_RUNTIME.md`](OPENHEXA_WEBAPP_RUNTIME.md#embedding-an-html-report-iframe).
