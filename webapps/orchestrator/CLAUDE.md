# `webapps/orchestrator/` — app rules

Loaded when working in this folder. Architecture: [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md);
OpenHEXA runtime patterns: [`docs/OPENHEXA_WEBAPP_RUNTIME.md`](../../docs/OPENHEXA_WEBAPP_RUNTIME.md);
deploying: [`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md). UX target:
[`design/wireframes/orchestrator_wireframe_cockpit.html`](../../design/wireframes/orchestrator_wireframe_cockpit.html)
and [`docs/PRODUCT_SPEC.md`](../../docs/PRODUCT_SPEC.md).

## The bundle

These five files are the deployed bundle, flat, as-is — **no build step, no CDN, no new files
without a reason** ([ADR 0007](../../docs/decisions/0007-multi-file-bundle-no-build.md)). This
`CLAUDE.md` is the only non-bundle file here; never deploy it.

| File | Role |
|---|---|
| `index.html` | Minimal shell: containers, header appbar, EN/FR toggle, links to `styles.css` / `app.js` |
| `styles.css` | All styling |
| `app.js` | All logic + the `I18N` string table. Fetches the two JSON files as same-origin siblings |
| `pipeline_map.json` | Hand-authored map — contract: [`contracts/pipeline_map.schema.json`](../../contracts/pipeline_map.schema.json) |
| `pipeline_descriptions.json` | Hand-authored descriptions — contract + Markdown-lite rules: [`contracts/pipeline_descriptions.schema.json`](../../contracts/pipeline_descriptions.schema.json) |

Constants at the top of `app.js` that encode contracts with the outside world:

- `CARDS_OBJECT_KEY` — the catalog's **bucket key**. Lockstep with
  `pipelines/create_pipeline_cards/config.py` (`OUTPUT_DIR` + `WEBAPP_CARDS_PATH`); it is a runtime
  path, not a repo path. Never "fix" its `utils_pipelines/` prefix.
- The SaaS front-end base `https://app.openhexa.org` — never derive it from `location.hostname`
  ([ADR 0010](../../docs/decisions/0010-hardcoded-saas-front-end-base.md)).
- `GENERATOR_TEMPLATE_NAME` — the generator template's display name, used in the install deep link.
  If the template is renamed, the link breaks silently.
- `POLL_INTERVAL_MS` / `POLL_MAX_ATTEMPTS` — poll every 5 s for up to 40 min, then show "stopped
  watching — still running in OpenHEXA". `RUN_ACTIVE_STATUSES` / `isRunFinished` keep polling
  through `terminating`.

## Bilingual text

([ADR 0008](../../docs/decisions/0008-one-bilingual-app.md))

- **`t(key, params)`** looks up chrome strings; a missing key falls back to English, then to the key
  itself (so a typo is visible). **Add every new chrome string to both `I18N.en` and `I18N.fr`.**
- **`pickLang(v)`** resolves data values: an `{ en, fr }` object picks the active language, falls
  back to `en`, then `""`; a plain string is returned as-is.
- **Editing a description or a map `label` means editing both languages.** Do not flatten the
  `{ en, fr }` shape. Do not invent description prose unprompted; translate on request. French
  copy is drafted or reviewed by Giulia.
- **Structural fields are never translated:** `id`, `code`, `type`, `group`, `row`/`col`, `track`,
  `ohName`.
- Language at boot: `?lang=` (wins, and is persisted) → `localStorage["snt_lang"]` → `en`.
  Switching sets `LANG`, rebuilds the steps and re-renders from scratch; there is no partial-update
  path to maintain.
- The `I18N.fr` strings are drafts pending review ([UI-5](../../docs/BACKLOG.md#ui-5)); do not
  present them as final.

## HTML injection seam

⚠️ The boot panel and the run-status lines are set with `innerHTML`. Build a **pre-escaped** HTML
string (`escapeHtml`), and make sure every dynamic value passed through `t()` into those paths is
already escaped. `missingCatalogError` attaches its pre-built HTML as `err.htmlMessage`. Handing
unescaped data (pipeline names, error text, URLs) to these paths is an injection.

## Catalog diagnosis

When `loadCards()` fails, the boot panel explains why
([`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#diagnosing-a-missing-catalog)). Pieces, near the
top of `app.js`: `GENERATOR_QUERY`, `looksLikeGenerator`, `diagnoseMissingCatalog`,
`generatorTemplateUrl` / `generatorPipelineUrl` / `generatorRunUrl`, `missingCatalogError`; i18n keys
`boot.cardsMissing` / `boot.cardsUnreadable` / `boot.noWorkspace`.

- **Never hardcode the generator's code.** `looksLikeGenerator` lowercases `code`/`name`, strips
  non-alphanumerics and tests for `pipelinecards` (`GENERATOR_KEY_MATCH`). Links are built from the
  `code` the query actually returned.
- `diagnoseMissingCatalog` is reused by the run-error drift hint, so it resolves the generator's
  state generally, despite its name.

## Run errors

`runErrorInfo(errors)` → `{text, drift}` translates `PipelineError` codes (compare exact values; the
generic branch still prints the codes, so nothing is swallowed). The four drift codes
(`INVALID_CONFIG`, `PIPELINE_DOES_NOT_SUPPORT_PARAMETERS`, `PIPELINE_NOT_FOUND`,
`PIPELINE_VERSION_NOT_FOUND`) get a "refresh the catalogue" line from `catalogueRefreshHintHtml`.

- **The hint renders in a second pass.** `runNode` paints the error at once, then re-renders with
  the hint when the extra `pipelines(...)` query resolves. Safe because `setRunStatusLine` no-ops
  when `APP.selectedId !== nodeId`, so a slow lookup cannot paint onto another node.
- ⚠️ **`.sb-runstatus` is `display: flex; flex-wrap: wrap`** — a `<br>` inside it is a flex item and
  does **not** break the line. A second line must be a `<span class="rs-hint">` (`flex: 0 0 100%` in
  `styles.css`). Same for any future second line there.
- New mappings need strings in both `I18N` tables (keys `runerr.*`, `link.refreshCatalogue`).

## Other seams

- **Parameter controls:** `fieldControlHtml` has dedicated controls only for DHIS2 and custom
  connections (dropdowns from `workspace { connections }`, needing `USER_READ`). Other connection
  types (`IASOConnection`, `PostgreSQLConnection`, `GCSConnection`, `S3Connection`) fall back to a
  text input; a new type needs a branch there.
- **Report embed:** `renderReportEmbeds()` mounts the HTML report in an `<iframe>` on a signed URL
  and re-signs on demand — never cache a signed URL.
- **Node state:** `cockpitState(node)`, `lockedReason()` (group-aware unlock), `computeGroupInUse()`
  (mutual exclusion) — semantics in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md#node-states).
- **Panel sections:** `makeSectionsCollapsible` turns each labelled section into a collapsible box;
  Dependencies starts collapsed. The description block is not a section and stays open.

## After changing anything here

A change to any bundle file needs a redeploy to take effect ([`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md)).
Comment-only changes can wait for the next real deploy.
