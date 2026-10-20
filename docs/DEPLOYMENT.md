# Deployment — webapp bundle, catalog generator, new workspaces

How changes in this repo reach an OpenHEXA workspace. The repo is the source of truth for the app;
each workspace's bucket is the source of truth for its catalog; **nothing about deployments is
recorded in the repo** ([ADR 0011](decisions/0011-repo-is-not-a-deployment-record.md)) — webapp
`id`, `slug`, URL, scopes and `isPublic` are always resolved live.

## What gets deployed

- **The webapp:** the five files in `webapps/orchestrator/`, flat, exactly as they are in the repo
  — **not** the folder's `CLAUDE.md` (agent notes), and **never a `pipeline_cards.json`** — a copy found inside a deployed webapp is a leftover nothing
  fetches; remove it with `files_to_delete_json` ([OPS-2](BACKLOG.md#ops-2)).
- **The generator:** `pipelines/create_pipeline_cards/`, pushed with the OpenHEXA CLI
  (`openhexa pipelines push`) or installed from the template `Create pipeline_cards.json`. Giulia
  pushes and runs pipelines herself; the agent stops at "ready to push" with the command and a test
  plan.
- **The catalog** is never deployed — it is produced by running the generator in the workspace.

## Before you edit a deployed webapp

1. Resolve the webapp live: `list_static_webapps(workspace_slug)` → `id` (for writes) and `slug`
   (for reads).
2. Read the live file(s) you will change — `get_static_webapp_file` — and diff against
   `webapps/orchestrator/`. This catches edits made directly in the OpenHEXA UI before you
   overwrite them.

## Choosing a deploy path

| Change | Path |
|---|---|
| Small, targeted edit to one existing text file (a few lines of `app.js`, a CSS tweak, one description) | `edit_static_webapp_file` |
| New file, wholesale rewrite, full bundle, first deploy | `update_static_webapp` — **or** drag-and-drop in the OpenHEXA UI |
| Remove a file | `update_static_webapp` with `files_to_delete_json` |

For a wholesale rewrite or a full bundle, offer the manual path first: *"You can also drag the
changed file(s) from `webapps/orchestrator/` straight into the webapp in OpenHEXA — no agent token
cost. Want to do that instead, or shall I deploy via the API?"* (`app.js` alone is ~100 KB.)

**Partial deploys work**: `files_json` may carry only the changed files; omitted files are left as
they are, not deleted.

**After any deploy**, read the changed file(s) back (`get_static_webapp_file`) and diff against the
repo.

### MCP tools

Static webapps are stored as **git repositories** on the platform, so every write below is a
commit.

- **`edit_static_webapp_file(webapp_id, path, old_string, new_string, replace_all?)`** — the backend
  applies a find/replace and commits; the agent never loads the whole file. `old_string` must match
  exactly (whitespace included) and be unique unless `replace_all: true`. Text files only.
- **`update_static_webapp(webapp_id, files_json?, files_to_delete_json?, name?, description?, allowed_operations?)`**
  — `files_json` is a JSON array of `{path, content}` with contents inline (it cannot read a path on
  disk); `files_to_delete_json` is an array of paths (missing ones are ignored). Both apply as one
  commit. `name`/`description` are honoured — **a rename is outward-facing: confirm with Giulia
  first**, then re-read with `list_static_webapps`.
- **`create_static_webapp(workspace_slug, name, files_json, description?, allowed_operations?)`** —
  `index.html` required. No `isPublic` / `icon` / `subdomain` (UI or raw GraphQL `updateWebapp`).
- **`get_static_webapp_file(workspace_slug, webapp_slug, path, start_line?, end_line?)`** — one
  text file, optionally a line slice. Preferred for verifying an edit.
- **`get_static_webapp(workspace_slug, webapp_slug)`** — every text file inline plus metadata
  (`allowedOperations`, `permissions`, per-file `encoding`). Expensive (`app.js` is ~100 KB); use
  it only for a full drift audit. Binary files come back as `content: null`, so it cannot back up an
  image.

Read tools take the **slug**; write tools take the **`id`**.

### Other deploy paths

- **OpenHEXA UI** — drag-and-drop files into the webapp.
- **Raw GraphQL** — `updateWebapp` with `files` / `filesToDelete` against `app.openhexa.org/graphql/`
  as the user.
- The OpenHEXA **CLI deploys pipelines only**, and the Python SDK's webapp surface is read-only
  (`workspace.get_webapp(slug)`, `OpenHexaClient().get_webapp_by_slug(...)`) — neither can deploy a
  webapp ([OH-1](BACKLOG.md#oh-1)).

### Version history and rollback

Because webapps are git-backed, the GraphQL `Webapp` type exposes `versions` (`WebappVersion { id,
message, authorName, authorEmail, date }`), `commitDiff(ref)`, `files(ref:)`, `previewUrl`,
`serveUrl` and `subdomain`; `UpdateWebappInput.publishedVersionId` selects which commit is served.
**No MCP tool exposes these** — only the OpenHEXA UI or raw GraphQL. A tested rollback procedure is
open ([REL-3](BACKLOG.md#rel-3)).

## Setting scopes

The app needs `PIPELINES_READ`, `PIPELINES_RUN`, `FILES_READ`, `USER_READ` (why:
[`OPENHEXA_WEBAPP_RUNTIME.md`](OPENHEXA_WEBAPP_RUNTIME.md#allowed_operations-scopes)). Scopes are
webapp metadata, set at create/update time, not sent with file deploys. Three ways:

- **OpenHEXA UI** — webapp → **API access** tab → one toggle per operation.
- **MCP** — `allowed_operations` on `create_static_webapp` / `update_static_webapp`, as a **list**
  of enum values: `PIPELINES_READ`, `PIPELINES_RUN`, `FILES_READ`, `FILES_WRITE`, `DATASETS_READ`,
  `DATASETS_WRITE`, `USER_READ`, `DATABASE_READ`. Omit it to leave scopes untouched; an empty list
  revokes all API access.
- **Raw GraphQL** — against the main API as the user (not the webapp's own proxy, which cannot grant
  its own scopes):

  ```graphql
  mutation ($input: UpdateWebappInput!) {
    updateWebapp(input: $input) { success errors webapp { id allowedOperations } }
  }
  # { "input": { "id": "<webapp-uuid>",
  #              "allowedOperations": ["PIPELINES_READ","PIPELINES_RUN","FILES_READ","USER_READ"] } }
  ```

After changing scopes, re-read them with `get_static_webapp` (or `list_static_webapps`). Keep the
webapp **private** — a public webapp cannot call the proxy.

## New workspace checklist

1. Find the workspace slug (`list_workspaces`).
2. **Create the webapp with the four scopes** and deploy the five files from
   `webapps/orchestrator/`. Keep it private. Its slug should be
   `snt-pipelines-orchestrator-cockpit` (the generator's `config.WEBAPP_SLUG`); if it differs, the
   generator needs `WEBAPP_SLUG` edited and a redeploy.
3. **Then** install `create_pipeline_cards` (template `Create pipeline_cards.json`, or CLI push from
   `pipelines/create_pipeline_cards/`) and **run it once** — no parameters. It fails if step 2 is
   not done, because it curates against the deployed map.
4. Confirm the catalog exists:
   `list_files(workspace_slug, prefix="utils_pipelines/create_pipeline_cards/pipeline_cards/")`.
5. Open the app. Nothing to commit — the bundle is unchanged and the catalog is not a repo file.

## Adding or changing a pipeline

- **Pipeline already on the map:** install or upgrade it in the workspace, re-run
  `create_pipeline_cards`, refresh the app. No repo change, no redeploy.
- **A genuinely new step:** add a node (and edges) to `webapps/orchestrator/pipeline_map.json` and a
  bilingual entry to `pipeline_descriptions.json`, deploy those two files, then re-run the generator
  in each workspace (it curates against the deployed map). If the generator's
  `EXPECTED_NUM_PIPELINES` should change, push the generator too.

## Inspecting a workspace's catalog

- `list_files(workspace_slug, prefix="utils_pipelines/create_pipeline_cards/pipeline_cards/")` —
  cheap existence + `updatedAt` check. Do this before assuming a workspace has a catalog.
- `read_file(workspace_slug, "utils_pipelines/create_pipeline_cards/pipeline_cards/pipeline_cards.json")`
  — full contents, tens of KB. Prefer `list_files`, or ask Giulia to read one value off the UI, when
  you need a single fact.
- Previous versions are under `…/pipeline_cards/historical/` with a timestamp suffix — useful for
  diffing what changed between runs.

Never patch a catalog by hand to fix drift: re-run the generator.

## Refreshing the OpenHEXA schema

```bash
curl -fsSL -o reference/openhexa/schema.generated.graphql https://raw.githubusercontent.com/BLSQ/openhexa-app/main/frontend/schema.generated.graphql
```
