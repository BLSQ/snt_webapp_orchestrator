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

### <a id="dev-1"></a>DEV-1 · Adopt `dev.js` for local development

`https://api.openhexa.org/webapps/dev.js` lets a local page call a real workspace's proxy under a
deployed webapp's scopes ([how](OPENHEXA_WEBAPP_RUNTIME.md#local-development-devjs)). Would replace
most deploy-to-test loops. Reviewed change: a third-party script tag in `index.html` (inert when
deployed, per the doc).

### <a id="tool-1"></a>TOOL-1 · Dependency-free check script

Validate the JSON files against `contracts/`, check map node ids == description keys, and check
that relative links in every `.md` resolve.

## App

### <a id="ui-1"></a>UI-1 · Stop button

Via `stopPipeline` — no new scope (`PIPELINES_RUN`).

### <a id="ui-2"></a>UI-2 · Show run progress

`pipelineRun.progress` is available on every run; the status line shows only the status.

### <a id="ui-3"></a>UI-3 · Render `DatabaseTable` outputs

Add the `... on DatabaseTable` fragment if any SNT pipeline starts emitting tables.

### <a id="ui-4"></a>UI-4 · Translate parameter labels

Parameter labels, help and choices come from the catalog and are English only. PM decision:
[`PRODUCT_SPEC.md` §10 item 1](PRODUCT_SPEC.md#10-open-decisions-for-the-pm-with-recommended-version-placement).

### <a id="ui-5"></a>UI-5 · Review the French strings

`I18N.fr` and the `fr` sides of the data files are drafts pending Giulia's review.

### <a id="ui-6"></a>UI-6 · README drift

The detail panel links to the pipeline README on GitHub `main`, which may not match the installed
version. Candidate: show the template's "Template Documentation" in-app. Open question for the team:
how is that field linked to GitHub? ([`PRODUCT_SPEC.md` §10 item 8](PRODUCT_SPEC.md#10-open-decisions-for-the-pm-with-recommended-version-placement))

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
UI-9?

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
