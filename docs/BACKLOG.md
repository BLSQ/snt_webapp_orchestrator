# BACKLOG — open items for the SNT Pipelines Orchestrator repo

The **single list** of open work, unanswered questions and pending decisions for this repository.
Other documents state facts and link here for anything still open; they do not keep lists of their
own. Jira (project `SNT25`, epic `SNT25-536`) tracks planned work and is managed by Giulia; this
file holds the repo-level items behind it.

**How this file works**

- Each item has a stable ID. Link to it as `docs/BACKLOG.md#ui-1`. **Do not renumber, and do not
  reuse an ID** — other documents point at these IDs.
- **When an item is resolved, delete it.** There is no "done" section. If a decision settled it,
  write an ADR in [`decisions/`](decisions/README.md); if a fix settled it, the PR is the record.
- Product decisions owned by the PM stay in [`PRODUCT_SPEC.md` §10](PRODUCT_SPEC.md#10-open-decisions-for-the-pm-with-recommended-version-placement);
  the `PM-*` items here only point at them.

| Group | IDs |
|---|---|
| [Repo & docs](#repo--docs) | `REPO-*`, `DOC-*` |
| [Release & deploy](#release--deploy) | `REL-*`, `OH-*` |
| [Workspace operations](#workspace-operations) | `OPS-*`, `GEN-*` |
| [Dev experience & tooling](#dev-experience--tooling) | `DEV-*`, `TOOL-*` |
| [App](#app) | `UI-*`, `APP-*` |
| [Platform & portability](#platform--portability) | `PLAT-*` |
| [Product (PM)](#product-pm) | `PM-*` |

---

## Repo & docs

### <a id="repo-1"></a>REPO-1 · Convergence direction

Merge this repo into `snt_development`, or move both into a new "SNT stratification" repo (all
OpenHEXA pipelines + webapps)? Decide, then write an ADR. The layout is already neutral for either
direction ([ADR 0012](decisions/0012-one-folder-per-deployable-unit.md)).

### <a id="repo-2"></a>REPO-2 · Fix `snt_development`'s split pipeline layout

If converging: propose one folder per deployable unit there too (today one pipeline is split between
`<name>/` at the root and `pipelines/<name>/`). Depends on REPO-1.

### <a id="repo-3"></a>REPO-3 · Bucket key keeps the old `utils_pipelines/` name

The catalog's bucket key `utils_pipelines/create_pipeline_cards/pipeline_cards/pipeline_cards.json`
no longer matches the repo folder (`pipelines/`). Migrate it deliberately or keep it forever.
Migrating touches `CARDS_OBJECT_KEY` in `app.js`, `config.py`, and every workspace bucket (redeploy
both, re-run the generator everywhere).

### <a id="doc-2"></a>DOC-2 · Fill "not recorded" ADR dates from git history

ADRs 0004–0007 and 0010 say "Date: not recorded". `git log` on the old `CLAUDE.md` / `README.md`
in the archived predecessor repo `BLSQ/OpenHEXA-WebApp-Diary` may date them. Needs Giulia's OK to run `git log`; update only the
date line, never the decision.

## Release & deploy

### <a id="rel-1"></a>REL-1 · Release versioning

GitHub releases plus a `version.json` in the bundle, shown in the app footer, so a workspace's
deployed version is one file read. Check first whether git-backed webapps already answer it:
`Webapp.versions` / `GitSource.publishedVersion` may expose the deployed commit without a baked file.

### <a id="rel-2"></a>REL-2 · Webapp deployer

Likely a "webapps" section in `snt_workspace_bootstrap/snt_workspace_deployer`'s release manifest,
using `updateWebapp(files: …)`; needs a CUSTOM-connection token like the pipeline deployer. Check
what git-backed webapp versions already give.

### <a id="rel-3"></a>REL-3 · Tested rollback procedure

`UpdateWebappInput.publishedVersionId` can pin the served commit (raw GraphQL / UI only; no MCP
tool). Verify whether a later file update re-publishes HEAD automatically and whether `previewUrl`
serves an unpublished head, then document the procedure in [`DEPLOYMENT.md`](DEPLOYMENT.md#version-history-and-rollback).

### <a id="oh-1"></a>OH-1 · Ask OpenHEXA for a CLI/SDK webapp deploy command

The CLI deploys pipelines only and the SDK webapp surface is read-only. A request was said to be in
flight but is not tracked anywhere.

### <a id="oh-2"></a>OH-2 · Ask OpenHEXA to allow `workspace { connections }` through the webapp proxy

The proxy refuses `Workspace.connections` and `Connection.{id,name,slug,type}` even with
`USER_READ` ([runtime](OPENHEXA_WEBAPP_RUNTIME.md#allowed_operations-scopes)), so the
DHIS2/custom connection dropdowns never load and users must type a slug. Ask for those fields (no
secret fields) under `USER_READ` or a new scope. Until then the app's text fallback stands; the
dropdown and the "no connection of this type" note activate on their own once the query passes.

### <a id="oh-3"></a>OH-3 · Ask OpenHEXA to allow `PipelineVersion.files` through the webapp proxy

The app shows each pipeline's README for the version deployed in the workspace
([ADR 0016](decisions/0016-readmes-from-deployed-version.md)). It would rather read it straight
from the version's code:

```graphql
query ($id: UUID!) { pipelineVersion(id: $id) { files { name path content encoding } } }
```

`PIPELINES_READ` unlocks the top-level `pipelineVersion`, but its `SCOPE_GRANTS` entry
(openhexa-app `backend/hexa/webapps/scopes.py`) lists only 16 `PipelineVersion` fields (`id`,
`versionNumber`, `parameters`, `config`, …), not `files` or `zipfile`. `FileNode` is granted to
no scope either, so the proxy refuses the whole query. Ask for `PipelineVersion.files` and
`FileNode` (`name`, `path`, `type`, `content`, `encoding`) under `PIPELINES_READ` or a new
read-only scope. A README is no more sensitive than the parameters and config that are already
granted, but `files` also exposes the pipeline's source code, which is the question to put to the
devs. Until then, `create_pipeline_cards` copies each README into the bucket and the app reads it
with `FILES_READ`. If this is granted, the app could read READMEs directly, the copies could go,
and a README would match the deployed version even before the generator re-runs.

## Workspace operations

### <a id="ops-1"></a>OPS-1 · Unpublish the live Flowchart webapps?

Flowchart webapps may still be deployed (`snt-app-dev`, `snt-testing`, `cmr-snt-process` as of the
2026-10 cleanup). Decide whether to remove them ([ADR 0009](decisions/0009-cockpit-only-flowchart-parked.md)).

### <a id="ops-2"></a>OPS-2 · Delete leftover `pipeline_cards.json` inside deployed webapps

Webapps deployed before the catalog moved to the bucket may still carry a `pipeline_cards.json`;
nothing fetches it. Remove with `update_static_webapp(files_to_delete_json=…)`.

### <a id="ops-3"></a>OPS-3 · Delete leftover spike webapps?

`t0-9-status-proxy-spike` (snt-testing) and `report-embed-probe` (snt-app-dev) may still exist. Their
source is in the archived repo's
[`deprecated/`](https://github.com/BLSQ/OpenHEXA-WebApp-Diary/tree/bbd02388f0104d809e55a81f5b84b29ce6b569bd/deprecated).

### <a id="gen-1"></a>GEN-1 · Push the generator to each workspace

The repo's `config.NOTES` fills in the workspace slug, but a generator installed from an older
version still writes a hardcoded "SNT App Dev workspace" note into its catalog until it is
re-pushed and re-run in that workspace.

## Dev experience & tooling

### <a id="tool-1"></a>TOOL-1 · Dependency-free check script

Validate the JSON files against `contracts/`, check map node ids == description keys, and check
that relative links in every `.md` resolve.

## App

### <a id="ui-2"></a>UI-2 · Show run progress

`pipelineRun.progress` is available on every run; the status line shows only the status.

### <a id="ui-3"></a>UI-3 · Render `DatabaseTable` outputs

Add the `... on DatabaseTable` fragment if any SNT pipeline starts emitting tables.

### <a id="ui-4"></a>UI-4 · Translate parameter labels

Parameter labels, help and choices come from the catalog and are English only. PM decision:
[`PRODUCT_SPEC.md` §10 item 1](PRODUCT_SPEC.md#10-open-decisions-for-the-pm-with-recommended-version-placement).

### <a id="ui-5"></a>UI-5 · Review the French strings

`I18N.fr` and the `fr` sides of the data files are drafts pending Giulia's review.

### <a id="ui-7"></a>UI-7 · Per-type counts in the collapsed Dependencies header

_"Requires (2 pipelines)"_ / _"Unlocks (11 pipelines)"_ — still wanted now that the section starts
collapsed? ([`PRODUCT_SPEC.md` §10 item 9](PRODUCT_SPEC.md#10-open-decisions-for-the-pm-with-recommended-version-placement))

### <a id="ui-8"></a>UI-8 · Version drift check

Compare each card's `version_name` / `version_number` with the live
`pipelineByCode.currentVersion` and prompt for a catalog refresh only on real change; optionally pin
runs with `RunPipelineInput.versionId`.

### <a id="ui-9"></a>UI-9 · Run notifications and debug logs

`RunPipelineInput.sendMailNotifications` for long runs; `enableDebugLogs` when linking a user to a
failed run.

### <a id="ui-10"></a>UI-10 · Catalog read via `readFileContent` (optional)

Instead of `prepareObjectDownload` + `fetch` — only if signed-URL expiry or CORS becomes a problem.

### <a id="app-1"></a>APP-1 · `pipelines(…, perPage: 100)` never paginates

The status and generator-diagnosis queries silently truncate past 100 pipelines. Low risk today;
fix or accept.

### <a id="app-2"></a>APP-2 · DRC-specific connection placeholder

`form.connPlaceholder` (en + fr) reads `e.g. dhis2-nmdr-drc`. Use a neutral example? User-visible
string, so not changed silently.

### <a id="app-3"></a>APP-3 · Verify signed-URL expiry

The `renderReportEmbeds` comment claims ~1 h. Check one `downloadUrl`'s `X-Goog-Expires` in DevTools.

### <a id="app-4"></a>APP-4 · Verify the templates-tab deep link

Check that `/pipelines/?tab=templates` still lands on the templates tab.

### <a id="app-5"></a>APP-5 · Long runs stop being watched after 40 min

Polling ends with "stopped watching — still running in OpenHEXA". Fine, or extend it / pair it with
UI-9? Reloading the page resumes polling with a fresh 40-min budget.

### <a id="app-6"></a>APP-6 · "Refresh the catalogue" button in the run-error drift hint

The not-installed panel runs the generator itself ([ADR 0015](decisions/0015-webapp-may-run-the-generator.md)).
The drift hint under a rejected run (`catalogueRefreshHintHtml`) still only links to it. Reuse the
same control there? The status line is a flex row (`.rs-hint` for a second line).

### <a id="app-7"></a>APP-7 · "Refresh the catalogue" button in the boot "no catalogue" panel

Same question for the boot panel (`missingCatalogError`, states `neverRun` / `lastRunFailed`). The
app has not booted there, so the control would need to work without `APP` state.

### <a id="app-8"></a>APP-8 · Deep-link step 1 of the not-installed panel to the step's own template

Step 1 links to the templates tab (`/pipelines/?tab=templates`). OpenHEXA also has a page per
template, `/workspaces/<slug>/templates/<encoded template name>` (e.g. `…/templates/A.6%20DHIS2%20Incidence`),
the same shape `generatorTemplateUrl` already uses. The map has no template-name field, though.
`ohName` is display-only, and 5 of the 18 values don't match a current template name (see
[APP-9](#app-9)). A wrong name gives a broken page, and the app can't detect that. Options: build the
link from `ohName` once APP-9 is fixed and keep the two in lockstep, or add a `templateName` field to
the map contract. Either way, fall back to the templates tab when the field is missing.

### <a id="app-9"></a>APP-9 · `ohName` no longer matches the OpenHEXA template names

The contract says `ohName` must match the name shown in OpenHEXA. Against the template list, these
don't match: the four A.3 mean/median/IQR/magic-glasses nodes (templates are now `A.3.1 …`; PATH is
still `A.3 …`), and `snt_seasonality_rainfall` (template `D.3 ERA5 Seasonality - Rainfall`, map
`D.2 …`). Decide whether `ohName` mirrors the template name or the installed pipeline's name (they
can differ), then update the map.

### <a id="app-10"></a>APP-10 · Should a pipeline that has already run become locked again?

Only an installed, **never-run** pipeline can be locked (`showLocked` = `lockedReason()` and state
`none`, in the rail, the pill and `runRowHtml`). Example: A.2 succeeded last week, then A.1's latest
run failed. A.2 still shows "Succeeded" and its Run button stays enabled. Decide whether "locked"
should apply to an installed pipeline in any state whenever a hard prerequisite's latest run isn't a
success. If yes: how to show it alongside the pipeline's own last-run status (the pill shows one
state), and whether Run is disabled or only warned. Not-installed pipelines stay never-locked either
way.

### <a id="ui-11"></a>UI-11 · Confirm the "Queued" colours

`--queue` / `--queue-bg` in `styles.css` (grey text on OpenHEXA's gray-100) are a guess: the queued
badge shows for seconds in OpenHEXA and its colours weren't captured. Replace them once seen.

### <a id="app-11"></a>APP-11 · Output dataset links need `DATASETS_READ`

The proxy grants `DatasetVersion` / `Dataset` fields only under `DATASETS_READ`
([runtime](OPENHEXA_WEBAPP_RUNTIME.md#allowed_operations-scopes)), which the app does not have
(R9). So `DATASET_OUTPUTS_QUERY` is refused and the Latest outputs box lists no dataset links;
files and the HTML report are unaffected. Decide: add `DATASETS_READ` (changes R9) and the links
come back with no code change, or drop the query.

## Platform & portability

### <a id="plat-1"></a>PLAT-1 · Self-hosted OpenHEXA

The front-end base `https://app.openhexa.org` is hardcoded
([ADR 0010](decisions/0010-hardcoded-saas-front-end-base.md)). A self-hosted install needs it from
config, or from `window.OPENHEXA` if the platform ever exposes it.

## Product (PM)

Owned by the PM; full text and recommended version in
[`PRODUCT_SPEC.md` §10](PRODUCT_SPEC.md#10-open-decisions-for-the-pm-with-recommended-version-placement).

- <a id="pm-1"></a>**PM-1** · In-app failure help: plain-language summary + run messages/log
  excerpts (v2) — §10 item 2.
- <a id="pm-2"></a>**PM-2** · "Recommend the next step" banner/badge (v2) — §10 item 4.
- <a id="pm-3"></a>**PM-3** · Team run model and "who is running what" (v2) — §10 item 5.
- <a id="pm-4"></a>**PM-4** · Connections and setup ownership (v2) — §10 item 6.
- <a id="pm-6"></a>**PM-6** · Full narrative layer / onboarding tour (v2, parked) — §7 and §9.
