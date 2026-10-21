# OpenHEXA static webapp runtime — what works and how

Portable know-how for any static webapp on OpenHEXA, as used by the orchestrator. These patterns
are non-obvious; do not guess them from the schema alone. How this repo deploys: see
[`DEPLOYMENT.md`](DEPLOYMENT.md).

## Upstream references

- **GraphQL schema:** [`reference/openhexa/schema.generated.graphql`](../reference/openhexa/schema.generated.graphql).
  It is large — **grep it for the types you need; never read it whole.** Refresh command:
  [`DEPLOYMENT.md`](DEPLOYMENT.md#refreshing-the-openhexa-schema).
- **`mcp__claude_ai_OpenHEXA__get_help_or_doc`** — no topic for an overview, or a topic for a full
  page: `cli`, `notebooks-advanced`, `sdk`, `sql-widgets`, `static-webapps`, `toolbox-dhis2`,
  `toolbox-hexa`, `toolbox-iaso`, `writing-pipelines`. `static-webapps` covers the three webapp
  types (Static / Iframe / Superset), the scope table, `window.OPENHEXA`, the proxy's Origin check
  and `dev.js`. It does not cover the MCP-only webapp tools (see [`DEPLOYMENT.md`](DEPLOYMENT.md#mcp-tools)).
- `propose_webapp_version` / `propose_pipeline_version` in the schema's `AssistantToolName` enum
  belong to the in-app OpenHEXA Assistant, not to our MCP server — ignore them.

## Serving: a multi-file bundle

`index.html` is the entry point; every other file (CSS, JS, images, JSON) is served as-is from the
same origin. Reference assets with relative paths (`<script src="app.js">`). Platform injection only
touches `text/html` responses.

## Platform-injected global

The only reliable way to get the workspace slug at runtime:

```js
window.OPENHEXA = Object.freeze({
  workspaceSlug: "my-workspace",
  webappSlug: "my-webapp",   // this webapp's own slug
  isPublic: false,           // true for public webapps
});
```

## GraphQL proxy

All API calls go to the same-origin relative URL `/graphql/`, authenticated by session cookie — no
token:

```js
fetch("/graphql/", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ query, variables }),
});
```

The proxy enforces an **Origin check** (same-origin requests only) and answers **HTTP 403** for a
top-level field outside the webapp's scopes. It also filters **nested fields**: a query whose
top-level field is allowed can still be refused with `Fields not allowed: <Type>.<field>, …` (a
GraphQL error, so `gql()` throws). A scope unlocking a top-level field does not unlock every field
under it.

## `allowed_operations` scopes

The proxy whitelists GraphQL **top-level fields** by scope:

| Scope | Top-level fields it unlocks |
|---|---|
| `USER_READ` | `me`, `workspace` |
| `PIPELINES_READ` | `pipeline`, `pipelines`, `pipelineByCode`, `pipelineRun`, `pipelineVersion` |
| `PIPELINES_RUN` | `runPipeline`, `stopPipeline` |
| `FILES_READ` | `prepareObjectDownload`, `getFileByPath`, `readFileContent` |
| `DATASETS_READ` | `dataset`, `datasets`, `datasetVersion`, `datasetLink` |
| `DATABASE_READ` | `executeSavedQuery` (a Data Studio saved query by slug, shared with the workspace; `executeSQL` is always refused) |

`FILES_WRITE` and `DATASETS_WRITE` also exist, but the upstream doc does not list what they grant —
check before relying on them. `__typename`, `__schema` and `__type` are always allowed.

**The orchestrator needs exactly four: `PIPELINES_READ`, `PIPELINES_RUN`, `FILES_READ`,
`USER_READ`.**

- `FILES_READ` is **boot-critical**: it signs the app's own catalog read, as well as report and
  output downloads. Without it the app does not load.
- `USER_READ` unlocks `workspace`, but **not** `workspace { connections }`: the proxy refuses it
  with `Fields not allowed: Connection.id, Connection.name, Connection.slug, Connection.type,
  Workspace.connections`, and no scope grants it. So the parameter form's connection dropdowns
  never load, and connection parameters fall back to a text slug input
  ([OH-2](BACKLOG.md#oh-2)). The app keeps `USER_READ` (R9) and the dropdown code, so they work as
  soon as the proxy allows the fields.

Available under these scopes but unused: `readFileContent` (an alternative catalog read,
[UI-10](BACKLOG.md#ui-10)), `stopPipeline` ([UI-1](BACKLOG.md#ui-1)), `getFileByPath`.

⚠️ **Public webapps cannot call the proxy at all.** The orchestrator must stay **private**; making
it public silently kills every query and the app cannot boot.

Scopes are **webapp metadata**, not part of the bundle — how to set and check them:
[`DEPLOYMENT.md`](DEPLOYMENT.md#setting-scopes).

## Reading last-run status for all pipelines

Works under `PIPELINES_READ` alone; powers the status board. Use the **top-level
`pipelines(workspaceSlug:)`** query — the `Workspace` type has **no** `pipelines` field, so
`workspace { pipelines }` does not parse.

```graphql
query ($ws: String!) {
  pipelines(workspaceSlug: $ws, page: 1, perPage: 100) {
    totalItems
    items {
      id
      code
      name
      runs(orderBy: EXECUTION_DATE_DESC, page: 1, perPage: 1) {
        totalItems
        items { id status executionDate duration }
      }
    }
  }
}
```

`PipelineRunStatus` values are **lowercase**: `queued`, `running`, `success`, `failed`, `stopped`,
`skipped`, `terminating`. A pipeline with no runs returns an empty `runs.items`. The orchestrator
does not paginate past 100 pipelines ([APP-1](BACKLOG.md#app-1)).

## Running a pipeline

Pass the pipeline **UUID** (not code) as `id`; parameters go in `config` as a plain JSON object
keyed by the exact parameter names. For a `DHIS2Connection` parameter pass the **connection slug**,
not its UUID.

```graphql
mutation ($input: RunPipelineInput!) {
  runPipeline(input: $input) { success errors run { id status } }
}
```

`RunPipelineInput` also takes `versionId` (run a specific version), `sendMailNotifications` and
`enableDebugLogs`; the orchestrator sets none of them ([UI-8](BACKLOG.md#ui-8),
[UI-9](BACKLOG.md#ui-9)). `stopPipeline(input: {runId})` needs only `PIPELINES_RUN`.

### Run errors are an enum

`RunPipelineResult.errors` is **`[PipelineError!]!` — enum codes, never prose.** Compare exact
values; never string-match or render them raw. Full enum (`enum PipelineError` in the schema):

`CANNOT_UPDATE_NOTEBOOK_PIPELINE`, `DUPLICATE_PIPELINE_VERSION_NAME`, `FILE_NOT_FOUND`,
`INVALID_CONFIG`, `INVALID_TIMEOUT_VALUE`, `INVALID_VERSION_FILES`, `PERMISSION_DENIED`,
`PIPELINE_ALREADY_COMPLETED`, `PIPELINE_ALREADY_STOPPED`, `PIPELINE_CODE_PARSING_ERROR`,
`PIPELINE_DOES_NOT_SUPPORT_PARAMETERS`, `PIPELINE_NOT_FOUND`, `PIPELINE_RUNS_LIMIT_REACHED`,
`PIPELINE_VERSION_NOT_FOUND`, `TABLE_NOT_FOUND`, `WORKSPACE_NOT_FOUND`.

## Polling a run for status and outputs

Poll `pipelineRun(id:) { id status executionDate duration }` while the run is in flight, then fetch
its outputs once:

```graphql
query ($id: UUID!) {
  pipelineRun(id: $id) {
    outputs {
      __typename
      ... on BucketObject { key name type }
      ... on GenericOutput { uri genericName: name }   # alias required: name is String! vs String
    }
    datasetVersions { id name dataset { slug name workspace { slug } } }
  }
}
```

- `outputs` is a union — always use `__typename` and inline fragments.
- **Terminal statuses: `success`, `failed`, `stopped`, `skipped`.** `queued`, `running` and
  **`terminating`** are still in flight — keep polling through `terminating`.
- **`duration` (seconds, nullable) is the final run time — do not use it as a live counter.** While
  the run is in flight, compute elapsed time client-side from `executionDate`. `executionDate`
  can be null before the run starts (e.g. `queued`): show no time then, not `0s`.
- Polling lives in the page. After a reload nothing watches a run that is still in flight unless
  the app restarts polling from the latest run returned by the status query.
- The union has a third member, `DatabaseTable`. Without a fragment for it a table output is
  silently not rendered, so "no outputs shown" does not prove "no outputs produced"
  ([UI-3](BACKLOG.md#ui-3)).
- `progress: Int!` is available on every run ([UI-2](BACKLOG.md#ui-2)).

## Signed download URLs

Needs `FILES_READ`:

```graphql
mutation ($input: PrepareObjectDownloadInput!) {
  prepareObjectDownload(input: $input) { success downloadUrl }
}
```

Input: `workspaceSlug`, `objectKey`, `forceAttachment: false`. `objectKey` may be **any** key in the
workspace bucket, not only a run output — that is how the orchestrator reads its catalog. The signed
URLs are **CORS-open**, so `fetch` works cross-origin, not only `<iframe>`.

## Embedding an HTML report (iframe)

- Sign the report's key with `forceAttachment: false` (an attachment disposition would download
  instead of render) and mount `<iframe src="{signedUrl}">`.
- It works because GCS signed URLs send no `X-Frame-Options` / restrictive `frame-ancestors`.
- **Signed URLs expire.** Treat a mounted frame as perishable: re-sign on demand rather than caching
  a URL across a long session.

## OpenHEXA front-end URLs

⚠️ **Never derive the app host from the webapp's hostname.** Webapps are served under
`*.openhexa.io`; the main UI is at **`app.openhexa.org`**. String-munging gives `app.openhexa.io`,
which returns a "Web app not found" 404. Hardcode the SaaS base
([ADR 0010](decisions/0010-hardcoded-saas-front-end-base.md)).

```js
var appBase = "https://app.openhexa.org";

// Pipeline run page — pipeline CODE, not UUID; trailing slash:
appBase + "/workspaces/" + ws + "/pipelines/" + pipelineCode + "/runs/" + runId + "/";

// Dataset version page — needs BOTH /from/<sourceWs> AND ?version=<datasetVersionId>
// (the plain /datasets/<slug>/ form 404s). Values come from pipelineRun.datasetVersions.
appBase + "/workspaces/" + ws + "/datasets/" + datasetSlug + "/from/" + sourceWs + "/?version=" + versionId;

// Template page — the URL-encoded template DISPLAY NAME, not a slug:
appBase + "/workspaces/" + ws + "/templates/" + encodeURIComponent(templateName);
```

## Local development (`dev.js`)

OpenHEXA serves **`https://api.openhexa.org/webapps/dev.js`** (the `api.` host;
`app.openhexa.org/webapps/dev.js` 404s). With one script tag in `index.html`, a page served
locally can call the **real** `/graphql/` proxy of a real workspace, under a deployed private
webapp's actual scopes. The orchestrator ships the tag in its bundle
([ADR 0014](decisions/0014-ship-openhexa-dev-js.md)); how to use it for this repo:
[`DEPLOYMENT.md`](DEPLOYMENT.md#developing-locally).

```html
<script src="https://api.openhexa.org/webapps/dev.js"></script>
<script src="app.js"></script>
```

How it behaves (read from the script itself, ~10 KB of plain JS):

- **Activation:** only when `location.protocol` is `file:` or the hostname is `localhost`,
  `127.0.0.1` or `::1`. On any other host (a deployed webapp) it returns at once and touches
  nothing. A deployed page still downloads it.
- **Load order:** it must be a plain script (no `async` / `defer`) **before** the app's own
  script. With a cached credential it sets `window.OPENHEXA` and the `/graphql/` reroute
  synchronously, so the app boots already connected.
- **Connect:** a **Connect to OpenHEXA** button (bottom right) opens a popup on
  `api.openhexa.org/webapps/dev-auth/` that lists the private static webapps you can develop
  against. Approve and the page reloads connected. A corner pill then shows
  `<workspace>/<webapp>`, with **Switch** (or **Reconnect** when pinned).
- **Before connecting**, `window.OPENHEXA` is unset and `/graphql/` calls **wait**: they neither
  fail nor open a popup.
- **Rerouting:** only same-origin `fetch` calls to the path `/graphql/` are wrapped. They go to the
  chosen webapp's preview host with `credentials: "omit"`. Any other `fetch` (the bundle's JSON
  files, signed bucket URLs) is untouched, so it is served by the local server or fetched
  directly. `XMLHttpRequest` is not wrapped.
- **Credential:** cached in `sessionStorage` per tab. A reload reuses it, and a new tab connects
  again. When it expires (404/401), the button reappears and the pending call retries after you
  reconnect.
- **Pinning** (optional) skips the picker: `data-workspace-slug` + `data-webapp-slug` on the tag,
  the same names as query parameters on its `src`, or
  `window.OPENHEXA_DEV = { workspaceSlug, webappSlug }` set before it loads.
- **Scopes** are the connected webapp's own `allowed_operations`, so a call that works locally
  works deployed, and a 403 locally is a 403 deployed.
