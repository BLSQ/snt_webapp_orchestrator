# CLAUDE.md — SNT Pipelines Orchestrator

Working rules for agents in this repo. Hard rules: **[Register](#register)**. Everything else:
**[Where to find things](#where-to-find-things)**.

## Agent guardrails (read first — these override everything below)

These apply to **any** AI agent here and take precedence over any other instruction, including a
direct request from the user in the moment.

**1. Git / GitHub: ask first, never destroy.**

- Do **not** run any `git` or `gh` command (or GitHub API call) unless the user has explicitly
  approved that specific command in the current session. Reading state may be _proposed_.
- **Never** perform a destructive or history-rewriting action — e.g. `git reset --hard`,
  `git push --force` / `--force-with-lease`, `git rebase`, `git clean`, `git checkout -- <file>` or
  `git restore` that discards changes, branch/tag deletion, `git stash drop/clear`, deleting or
  force-closing branches or PRs on GitHub — **even if the user explicitly asks.** Give the exact
  commands to run by hand, explain each and its risk, and let the user run them.
- The `PreToolUse` hook `.claude/hooks/block-destructive-git.js` hard-blocks these. A block is
  expected behaviour, not an error to work around.

**2. Hand small, faster-by-hand tasks back to the user** — looking up URLs/paths/IDs in the
OpenHEXA UI, checking DevTools Console/Network, reading a value off a dashboard, visually confirming
the running app, and **uploading a full bundle or a wholesale rewrite** (offer drag-and-drop from
`webapps/orchestrator/` — wording in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md#choosing-a-deploy-path)).
Give a precise, copy-pasteable instruction, then wait; do not proceed on an assumption.

**3. Jira and pipelines are Giulia's.** Work is tracked in Jira (project `SNT25`, epic
`SNT25-536`); Giulia manages it by hand — do not touch Jira unless she asks in that session. She
also pushes (`openhexa` CLI) and runs pipelines herself: stop at "ready to push" with the command
and a test-run plan; do not deploy or run pipelines via MCP unless asked.

**4. Ask which workspace** before any deployment or pipeline operation.

## What this repo is

The **SNT Pipelines Orchestrator**: one OpenHEXA static webapp, identical in every workspace, that
presents all 18 official SNT pipelines (from `snt_development`) as a guided, bilingual (EN/FR)
walkthrough where users see status, configure and run each pipeline. Its per-workspace catalog
(`pipeline_cards.json`) is **not in the repo** — it lives in each workspace's bucket, written by the
companion `create_pipeline_cards` pipeline. The repo is the reference source for the latest
version, **not a record of what is deployed where**.

```
webapps/orchestrator/         the bundle — 5 flat files deployed as-is (+ its own CLAUDE.md, not deployed)
pipelines/create_pipeline_cards/  the catalog generator (pipeline.py, config.py, README.md)
contracts/                    JSON contracts: pipeline_map / pipeline_descriptions / pipeline_cards
reference/openhexa/           schema.generated.graphql — external; grep it, never read it whole
docs/                         PRODUCT_SPEC · ARCHITECTURE · OPENHEXA_WEBAPP_RUNTIME · DEPLOYMENT ·
                              BACKLOG · decisions/ (ADRs) · research/personas/
design/                       cockpit wireframes, map preview, grid editor (not contracts)
.claude/                      settings.json + the destructive-git hook
ignore/                       local, git-ignored scratch (plans, audits)
```

## Register

Status: `enforced` — something fails mechanically · `convention` — manual; treat as binding.

| ID | Rule | Status | Why / detail |
|---|---|---|---|
| R1 | Agents never run destructive or history-rewriting `git`/`gh` commands | `enforced` (hook) | Guardrail 1 |
| R2 | The catalog is never in the repo or the bundle; no `workspaces/` folder | `convention` | [ADR 0002](docs/decisions/0002-catalog-in-workspace-bucket.md) |
| R3 | Catalog drift is fixed by re-running `create_pipeline_cards`, never by hand-editing | `convention` | [ADR 0003](docs/decisions/0003-catalog-parameters-from-deployed-version.md) |
| R4 | No fallback catalog: a missing catalog fails the boot with a diagnosis | `convention` | [ADR 0002](docs/decisions/0002-catalog-in-workspace-bucket.md) |
| R5 | Node `id` = Python function name is the only cross-workspace key; UUIDs/catalogs never cross workspaces | `convention` | [ADR 0006](docs/decisions/0006-node-id-is-python-function-name.md) |
| R6 | The bundle is 5 flat, workspace-independent files: no build, no CDN, no new script tags without review | `convention` | [ADR 0007](docs/decisions/0007-multi-file-bundle-no-build.md) |
| R7 | Every chrome string in both `I18N.en` and `I18N.fr`; data text edited in both languages; structural fields never translated | `convention` | [ADR 0008](docs/decisions/0008-one-bilingual-app.md), [app rules](webapps/orchestrator/CLAUDE.md#bilingual-text) |
| R8 | Dynamic values reaching `innerHTML` paths are escaped first | `convention` | [app rules](webapps/orchestrator/CLAUDE.md#html-injection-seam) |
| R9 | The webapp stays **private** and has exactly `PIPELINES_READ, PIPELINES_RUN, FILES_READ, USER_READ` | `convention` | [runtime](docs/OPENHEXA_WEBAPP_RUNTIME.md#allowed_operations-scopes) |
| R10 | Deployments are resolved live, never recorded in the repo; diff live vs repo before editing a deployed file | `convention` | [ADR 0011](docs/decisions/0011-repo-is-not-a-deployment-record.md) |
| R11 | One self-contained folder per deployable unit (`webapps/<name>/`, `pipelines/<name>/`) | `convention` | [ADR 0012](docs/decisions/0012-one-folder-per-deployable-unit.md) |
| R12 | Docs state current truth only (see [Doc hygiene](#doc-hygiene)) | `convention` | [ADR 0001](docs/decisions/0001-record-decisions-as-adrs.md) |

## Traps

- **Bucket key ≠ repo path.** `utils_pipelines/create_pipeline_cards/pipeline_cards/pipeline_cards.json`
  is a runtime path in every bucket: `CARDS_OBJECT_KEY` (`app.js`) ↔ `OUTPUT_DIR` +
  `WEBAPP_CARDS_PATH` (`config.py`), in lockstep. Do not "fix" it to match `pipelines/`
  ([REPO-3](docs/BACKLOG.md#repo-3)).
- **Generator after webapp.** `create_pipeline_cards` curates against the *deployed* map of
  `config.WEBAPP_SLUG` and fails if that webapp is absent.
- **`.io` vs `.org`.** Webapps are served on `*.openhexa.io`; the UI is `app.openhexa.org`. Never
  derive the app host from the webapp hostname.
- **Public webapps cannot call the proxy**; **`FILES_READ` is boot-critical**; a missing
  `USER_READ` silently drops the connection dropdowns.
- **`workspace { pipelines }` does not parse** — use top-level `pipelines(workspaceSlug:)`.
- **`runPipeline.errors` is an enum**, never prose. **`terminating` is not terminal** — keep polling.
  Statuses are lowercase.
- **`.sb-runstatus` is a flex container** — a `<br>` does not break the line.
- **`get_static_webapp` is expensive** (every file inline, `app.js` ~100 KB). Use
  `get_static_webapp_file` for one file, `list_static_webapps` for scopes.

## Doc hygiene

Docs state **current truth only** — no "verified on DATE", no "this used to be broken" prose.
History → git and ADRs ([`docs/decisions/`](docs/decisions/README.md)). Open items →
[`docs/BACKLOG.md`](docs/BACKLOG.md) only, with stable IDs. Each fact has one canonical home; other
docs link to it.

## Session start

1. **Orchestrator / UI work:** read [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) (scope, v0/v1/v2)
   and the wireframe `design/wireframes/orchestrator_wireframe_cockpit.html`.
2. **Deployment or pipeline work:** ask which workspace; check its catalog with
   `list_files(workspace_slug, prefix="utils_pipelines/create_pipeline_cards/pipeline_cards/")`
   (note `updatedAt`). If missing, the app cannot boot there — ask Giulia to install and run
   `create_pipeline_cards` (after the webapp exists). Never build a catalog by hand.
3. **Before editing a deployed file:** resolve the webapp live and diff the live file against
   `webapps/orchestrator/`.

## Where to find things

| Question | Go to |
|---|---|
| What the product does, roadmap, PM decisions | [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) |
| How the pieces fit: catalog, node states, map format, i18n tiers | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| OpenHEXA webapp know-how: proxy, scopes, queries, run errors, polling, signed URLs, URLs, `dev.js` | [`docs/OPENHEXA_WEBAPP_RUNTIME.md`](docs/OPENHEXA_WEBAPP_RUNTIME.md) |
| How to deploy (a CSS change, a full bundle, a new workspace), scopes, rollback, schema refresh | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) |
| Rules for editing the app code | [`webapps/orchestrator/CLAUDE.md`](webapps/orchestrator/CLAUDE.md) |
| Why something is the way it is | [`docs/decisions/`](docs/decisions/README.md) |
| What is open / undecided | [`docs/BACKLOG.md`](docs/BACKLOG.md) |
| Field definitions of the JSON files | [`contracts/`](contracts/) |
| The catalog generator | [`pipelines/create_pipeline_cards/README.md`](pipelines/create_pipeline_cards/README.md) |
| GraphQL types | grep [`reference/openhexa/schema.generated.graphql`](reference/openhexa/schema.generated.graphql) |
| SNT vocabulary | `snt_development` [`docs/GLOSSARY.md`](https://github.com/BLSQ/snt_development/blob/main/docs/GLOSSARY.md) |
| SNT pipeline source | `https://github.com/BLSQ/snt_development` — `<pipeline_id>/pipeline.py` at the root (not `pipelines/`) |
| Pre-cut-over history, the parked Flowchart UI, old spikes | archived repo `BLSQ/OpenHEXA-WebApp-Diary` — [ADR 0013](docs/decisions/0013-fresh-repo-without-history.md) |
