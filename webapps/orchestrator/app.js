/* SNT Pipelines Orchestrator — Cockpit UI.
 *
 * A focused, one-step-at-a-time guided walkthrough (see
 * design/wireframes/orchestrator_wireframe_cockpit.html). The left rail lists
 * every step of the stratification process with a "you are here" marker; the
 * central panel carries everything for the focused step — dependencies, the
 * generated parameter form, the Run button, live status, and outputs. Back /
 * Next walk the recommended order; mutually-exclusive alternative groups (the
 * five A.3 outlier methods, the two A.4 reporting-rate methods) collapse into a
 * single "choose one" step.
 *
 * The bundle is self-contained and flat (webapps/orchestrator/), deployed as-is.
 *
 * Data, from two different places (join key everywhere is the node `id` ==
 * the pipeline's Python function name):
 *   - bundled, fetched same-origin alongside this file:
 *       pipeline_map.json          : the map (nodes, stage `row`, `track`,
 *                                    `group`, dependency `edges`)
 *       pipeline_descriptions.json : hand-authored node description text
 *   - read live from the workspace bucket (NOT bundled — see CARDS_OBJECT_KEY):
 *       pipeline_cards.json        : this workspace's catalog (which pipelines
 *                                    exist, their UUID + parameters), written by
 *                                    the companion `create_pipeline_cards`
 *                                    pipeline. Re-running that pipeline updates
 *                                    this app's config with no redeploy.
 */

/* ================================================================== *
 * GraphQL helper + queries (shared runtime patterns)
 * ================================================================== */
async function gql(query, variables) {
  var res = await fetch("/graphql/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: query, variables: variables || {} }),
  });
  var json = await res.json();
  if (json.errors)
    throw new Error(
      json.errors
        .map(function (e) {
          return e.message;
        })
        .join("; "),
    );
  return json.data;
}

// Cross-session status board: one query for the whole workspace, each pipeline
// with its single most-recent run. Confirmed working through the static-webapp
// proxy under PIPELINES_READ alone.
var STATUS_QUERY =
  "query ($ws: String!) {" +
  "  pipelines(workspaceSlug: $ws, page: 1, perPage: 100) {" +
  "    items {" +
  "      id" +
  "      code" +
  "      runs(orderBy: EXECUTION_DATE_DESC, page: 1, perPage: 1) {" +
  "        items { id status executionDate duration }" +
  "      }" +
  "    }" +
  "  }" +
  "}";

// Workspace connections — populates the DHIS2Connection / CustomConnection
// dropdowns in the form. Needs USER_READ; falls back to a text slug input.
var CONNECTIONS_QUERY =
  "query ($ws: String!) {" +
  "  workspace(slug: $ws) {" +
  "    connections { id name slug type }" +
  "  }" +
  "}";

// pipelineRun outputs for one run — datasets + bucket/generic file outputs.
// outputs is a union, so use __typename inline fragments.
var OUTPUTS_QUERY =
  "query ($id: UUID!) {" +
  "  pipelineRun(id: $id) {" +
  "    outputs {" +
  "      __typename" +
  "      ... on BucketObject { key name type }" +
  "      ... on GenericOutput { uri genericName: name }" +
  "    }" +
  "    datasetVersions { id name dataset { slug name workspace { slug } } }" +
  "  }" +
  "}";

// Signed download URL for a bucket object (HTML report etc.). Needs FILES_READ.
var DOWNLOAD_MUTATION =
  "mutation ($input: PrepareObjectDownloadInput!) {" +
  "  prepareObjectDownload(input: $input) { success downloadUrl }" +
  "}";

// Trigger a run. Pass the pipeline UUID as `id` + the form-built config. Needs
// PIPELINES_RUN.
var RUN_MUTATION =
  "mutation ($input: RunPipelineInput!) {" +
  "  runPipeline(input: $input) {" +
  "    success" +
  "    errors" +
  "    run { id status }" +
  "  }" +
  "}";

// Poll one run for its live status (PIPELINES_READ).
var RUN_POLL_QUERY =
  "query ($id: UUID!) {" +
  "  pipelineRun(id: $id) {" +
  "    id status executionDate duration" +
  "  }" +
  "}";

// Used only when the catalog is missing, to work out *why* (see
// diagnoseMissingCatalog): every pipeline in the workspace with its most recent
// run, so we can find the generator and see whether it has ever run.
var GENERATOR_QUERY =
  "query ($ws: String!) {" +
  "  pipelines(workspaceSlug: $ws, page: 1, perPage: 100) {" +
  "    items {" +
  "      id" +
  "      code" +
  "      name" +
  "      runs(orderBy: EXECUTION_DATE_DESC, page: 1, perPage: 1) {" +
  "        items { id status }" +
  "      }" +
  "    }" +
  "  }" +
  "}";

/* ================================================================== *
 * Data loading + merge
 * ================================================================== */
/* Where this workspace's pipeline catalog lives in the workspace bucket. Written
 * by the companion `create_pipeline_cards` pipeline — this key must stay in
 * lockstep with that pipeline's config.py (OUTPUT_DIR + WEBAPP_CARDS_PATH). It is
 * a bucket key, NOT a repo path: it does not follow the repo layout. The
 * catalog is deliberately NOT part of the deployed bundle: keeping it in the bucket
 * means a config change is one pipeline run, not a redeploy. */
var CARDS_OBJECT_KEY =
  "utils_pipelines/create_pipeline_cards/pipeline_cards/pipeline_cards.json";

async function fetchJson(url) {
  var res = await fetch(url);
  if (!res.ok)
    throw new Error("Failed to load " + res.url + " (HTTP " + res.status + ")");
  return await res.json();
}

/* Read the catalog out of the workspace bucket: prepareObjectDownload
 * (FILES_READ) mints a signed GCS URL, which we then fetch cross-origin — the
 * same mechanism as the report embeds below, and probe-confirmed CORS-open.
 * There is no bundled fallback by design: a workspace where
 * `create_pipeline_cards` has never run has no catalog, and that must surface as
 * a boot error rather than silently serving a stale bundled copy. */
async function loadCards() {
  var slug = workspaceSlug();
  if (!slug) throw new Error(t("boot.noWorkspace"));

  var url = await mintDownloadUrl(slug, CARDS_OBJECT_KEY);
  if (!url) throw await missingCatalogError(slug);

  var res = await fetch(url);
  if (!res.ok)
    throw new Error(
      t("boot.cardsUnreadable", { key: CARDS_OBJECT_KEY, status: res.status }),
    );
  return await res.json();
}

/* --- Why is there no catalog? ---------------------------------------- *
 * "No catalog" has several distinct causes, and they need opposite advice —
 * install the generator vs. just run it vs. look at why its last run failed.
 * Telling the user to install something that is already installed is worse
 * than saying nothing, so on the failure path (only) we ask the workspace
 * what state the generator is actually in. Costs one query, and only when
 * the app is already failing to boot; needs PIPELINES_READ, which we have.
 *
 * The generator is matched tolerantly: its OpenHEXA `code`/`name` depend on
 * how it got into the workspace — deployed from source it is
 * `create-pipeline-cards` / `create_pipeline_cards`, while installing from
 * the template names it "Create pipeline_cards.json". Normalising away
 * punctuation and looking for "pipelinecards" covers all of those without
 * hardcoding a code (which is workspace-specific anyway). */
var GENERATOR_TEMPLATE_NAME = "Create pipeline_cards.json";
var GENERATOR_KEY_MATCH = /pipelinecards/;
var RUN_ACTIVE_STATUSES = ["queued", "running", "terminating"];

function looksLikeGenerator(p) {
  function norm(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }
  return (
    GENERATOR_KEY_MATCH.test(norm(p && p.code)) ||
    GENERATOR_KEY_MATCH.test(norm(p && p.name))
  );
}

/* Resolve the generator's state. Returns one of:
 *   {state:"notInstalled"}
 *   {state:"neverRun",      code}
 *   {state:"inProgress",    code, runId}
 *   {state:"lastRunFailed", code, runId, status}
 *   {state:"unknown"}  — the probe itself failed, so stay generic rather than
 *                        assert something that might be wrong. */
async function diagnoseMissingCatalog(slug) {
  var found = null;
  try {
    var data = await gql(GENERATOR_QUERY, { ws: slug });
    var items = (data && data.pipelines && data.pipelines.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (looksLikeGenerator(items[i])) {
        found = items[i];
        break;
      }
    }
  } catch (e) {
    return { state: "unknown" };
  }

  if (!found) return { state: "notInstalled" };

  var last = (found.runs && found.runs.items && found.runs.items[0]) || null;
  if (!last) return { state: "neverRun", code: found.code };
  if (RUN_ACTIVE_STATUSES.indexOf(String(last.status).toLowerCase()) !== -1)
    return { state: "inProgress", code: found.code, runId: last.id };
  // Includes status "success": a successful run with no catalog still leaves
  // the app unbootable, and the run log is where the answer is.
  return {
    state: "lastRunFailed",
    code: found.code,
    runId: last.id,
    status: last.status,
  };
}

function generatorTemplateUrl(slug) {
  return (
    appBaseUrl() +
    "/workspaces/" +
    encodeURIComponent(slug) +
    "/templates/" +
    encodeURIComponent(GENERATOR_TEMPLATE_NAME)
  );
}

function generatorPipelineUrl(slug, code) {
  return (
    appBaseUrl() +
    "/workspaces/" +
    encodeURIComponent(slug) +
    "/pipelines/" +
    encodeURIComponent(code) +
    "/"
  );
}

function generatorRunUrl(slug, code, runId) {
  return (
    generatorPipelineUrl(slug, code) + "runs/" + encodeURIComponent(runId) + "/"
  );
}

/* Build the boot error for "this workspace has no catalog", with a link
 * pointing at whatever the user actually has to do next. The Error carries a
 * plain `message` (for the console) plus an `htmlMessage` that the boot panel
 * renders, because the guidance needs a real anchor element. */
async function missingCatalogError(slug) {
  var d = await diagnoseMissingCatalog(slug);
  var text;
  var href = null;
  var linkLabel = null;

  if (d.state === "notInstalled") {
    text = t("boot.generatorNotInstalled");
    href = generatorTemplateUrl(slug);
    linkLabel = t("link.installGenerator");
  } else if (d.state === "neverRun") {
    text = t("boot.generatorNeverRun");
    href = generatorPipelineUrl(slug, d.code);
    linkLabel = t("link.runGenerator");
  } else if (d.state === "inProgress") {
    text = t("boot.generatorInProgress");
    href = generatorRunUrl(slug, d.code, d.runId);
    linkLabel = t("link.openGeneratorRun");
  } else if (d.state === "lastRunFailed") {
    text = t("boot.generatorLastRunFailed", { status: d.status });
    href = generatorRunUrl(slug, d.code, d.runId);
    linkLabel = t("link.openGeneratorRun");
  } else {
    text = t("boot.cardsMissing", { key: CARDS_OBJECT_KEY });
  }

  var err = new Error(text);
  err.htmlMessage =
    escapeHtml(text) +
    (href
      ? '<br><a href="' +
        escapeHtml(href) +
        '" target="_blank" rel="noopener">' +
        escapeHtml(linkLabel) +
        "</a>"
      : "");
  return err;
}

async function loadData() {
  var results = await Promise.all([
    fetchJson("./pipeline_map.json"),
    fetchJson("./pipeline_descriptions.json"),
    loadCards(),
  ]);
  return { map: results[0], descriptions: results[1], cards: results[2] };
}

/* Merge the shared map with this workspace's cards. Every map node is kept; a
 * node is *available* iff its id matches a pipeline in the cards (with a uuid),
 * otherwise it renders as "not installed" (greyed / missing). Description text
 * comes from the shared, hand-authored pipeline_descriptions.json (one
 * copy across all workspaces), not from the map or the cards. */
function mergeNodes(map, cards, descriptions) {
  var cardsById = {};
  var pipelines = (cards && cards.pipelines) || [];
  for (var i = 0; i < pipelines.length; i++) {
    cardsById[pipelines[i].id] = pipelines[i];
  }
  var descById = (descriptions && descriptions.descriptions) || {};
  var nodes = (map && map.nodes) || [];
  return nodes.map(function (node) {
    var card = cardsById[node.id] || null;
    return {
      id: node.id,
      code: node.code,
      label: node.label,
      ohName: node.ohName || null,
      description: descById[node.id] || "",
      type: node.type,
      group: node.group || null,
      row: node.row,
      col: node.col,
      track: node.track,
      uuid: card ? card.uuid : null,
      parameters: card ? card.parameters || [] : [],
      available: !!(card && card.uuid),
    };
  });
}

/* ================================================================== *
 * Small helpers
 * ================================================================== */
function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Small Markdown-lite renderer for hand-authored pipeline descriptions
// (pipeline_descriptions.json): bold and italic markers, and newlines
// (`\n`) -> <br>. Nothing else (no headers/links/lists) — text is escaped first,
// so any other markup is shown literally rather than executed.
function mdLite(s) {
  var html = escapeHtml(s);
  html = html.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+?)__/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+?)\*/g, "<em>$1</em>");
  html = html.replace(/_([^_]+?)_/g, "<em>$1</em>");
  return html.replace(/\n/g, "<br>");
}

// The main OpenHEXA front-end lives at app.openhexa.org (a different domain from
// the *.openhexa.io static-webapp host) — hardcoded for the SaaS.
function appBaseUrl() {
  return "https://app.openhexa.org";
}

var GITHUB_REPO = "https://github.com/BLSQ/snt_development";
function githubFolderUrl(id) {
  return GITHUB_REPO + "/tree/main/" + encodeURIComponent(id);
}

function parseRunDate(s) {
  if (!s) return null;
  var iso = String(s)
    .replace(" ", "T")
    .replace(/(\.\d{3})\d+/, "$1");
  var d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function fmtRunDate(s) {
  var d = parseRunDate(s);
  if (!d) return "—";
  function p(n) {
    return (n < 10 ? "0" : "") + n;
  }
  return (
    d.getFullYear() +
    "-" +
    p(d.getMonth() + 1) +
    "-" +
    p(d.getDate()) +
    " " +
    p(d.getHours()) +
    ":" +
    p(d.getMinutes())
  );
}

function fmtDuration(sec) {
  if (sec == null) return null;
  var s = Math.max(0, Math.round(sec));
  var h = Math.floor(s / 3600);
  s -= h * 3600;
  var m = Math.floor(s / 60);
  s -= m * 60;
  function p(n) {
    return (n < 10 ? "0" : "") + n;
  }
  if (h) return h + "h " + p(m) + "m " + p(s) + "s";
  if (m) return m + "m " + p(s) + "s";
  return s + "s";
}

function isHtmlKey(key) {
  return /\.html?$/i.test(String(key || ""));
}

function workspaceSlug() {
  return window.OPENHEXA && window.OPENHEXA.workspaceSlug
    ? window.OPENHEXA.workspaceSlug
    : null;
}

/* ================================================================== *
 * i18n — language state, string table, and accessors
 * ------------------------------------------------------------------ *
 * The cockpit is bilingual (English / French). Scope of this phase:
 * app chrome (this string table), the hand-authored node descriptions
 * (pipeline_descriptions.json), and node/step titles
 * (pipeline_map.json `label`) — all resolved via pickLang(). Parameter
 * labels/help + dropdown choices (from pipeline_cards.json) stay English
 * for now. The whole panel re-renders from scratch on every render, so
 * switching language is just: set LANG, rebuild steps, re-render.
 * French strings below are drafts pending Giulia's review.
 * ================================================================== */
var LANGS = ["en", "fr"];
var LANG = "en";

// Resolve the active language once at boot: ?lang= query param (wins and is
// remembered) -> localStorage -> default "en".
function currentLang() {
  var q = null;
  try {
    q = new URLSearchParams(window.location.search).get("lang");
  } catch (e) {}
  if (q && LANGS.indexOf(q) >= 0) {
    try {
      localStorage.setItem("snt_lang", q);
    } catch (e) {}
    return q;
  }
  var stored = null;
  try {
    stored = localStorage.getItem("snt_lang");
  } catch (e) {}
  if (stored && LANGS.indexOf(stored) >= 0) return stored;
  return "en";
}

// Switch language: persist, update <html lang>, rebuild the (title-bearing)
// steps, refresh static shell text + toggle state, and re-render everything.
function setLang(l) {
  if (LANGS.indexOf(l) < 0 || l === LANG) return;
  LANG = l;
  try {
    localStorage.setItem("snt_lang", l);
  } catch (e) {}
  if (document.documentElement) document.documentElement.setAttribute("lang", l);
  if (APP.nodes && APP.nodes.length) APP.steps = buildSteps();
  applyStaticI18n();
  renderRail();
  renderCockpit();
}

// Resolve a possibly-bilingual data value. Nested { en, fr } objects pick the
// active language (falling back to en); a plain string is returned as-is, so
// legacy flat data still works.
function pickLang(v) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v[LANG] != null ? v[LANG] : v.en != null ? v.en : "";
  }
  return v == null ? "" : v;
}

// Chrome string lookup with {placeholder} substitution. Missing keys fall back
// to English, then to the key itself (so a typo is visible, not silent).
function t(key, params) {
  var table = I18N[LANG] || I18N.en;
  var s = table[key];
  if (s == null) s = I18N.en[key] != null ? I18N.en[key] : key;
  if (params) {
    s = s.replace(/\{(\w+)\}/g, function (m, k) {
      return params[k] != null ? params[k] : m;
    });
  }
  return s;
}

var I18N = {
  en: {
    // static shell
    workspaceWord: "Workspace:",
    back: "Back",
    next: "Next",
    // status labels
    "status.ok": "Succeeded",
    "status.fail": "Failed",
    "status.run": "Running…",
    "status.none": "Never run",
    "status.missing": "Not installed",
    "status.locked": "Locked",
    // tracks
    "track.A": "Track A · Routine Surveillance Data",
    "track.B": "Track B · Geo & raster",
    "track.C": "Track C · DHS surveys",
    "track.D": "Track D · Climate",
    "track.fallback": "Track {t}",
    // stages (currently dormant — breadcrumb stage display is commented out)
    "stage.0": "Extract",
    "stage.1": "Format",
    "stage.2": "Clean & enrich",
    "stage.3": "Derive",
    "stage.4": "Outputs",
    // alternative group titles
    "group.a3_outliers": "Outliers Imputation",
    "group.a4_reporting_rate": "Reporting Rate",
    "group.desc":
      "Pick one method, then configure and run it. The map treats the whole group as a single step — the method with the latest successful run is the one in use downstream.",
    // node type chips
    "type.mandatory": "mandatory",
    "type.alternative": "alternative",
    "type.facultative": "facultative",
    // rail
    "rail.head": "Stratification process · {n} steps",
    "rail.chooseOne": "choose one of {n}",
    // footer / appbar nav
    "foot.step": "Step {n} of {total}",
    // section headings
    "heading.chooseMethod": "Choose a method",
    "heading.dependencies": "Dependencies",
    "heading.runParams": "Run with Parameters",
    "heading.latestOutputs": "Latest outputs",
    "heading.more": "More",
    // dependency columns
    "dep.requires": "Requires (hard)",
    "dep.uses": "Uses if available (soft)",
    "dep.unlocks": "Unlocks next",
    "dep.none": "none",
    // chips
    "chip.notInstalled": "not installed",
    "chip.chooseNof": "choose 1 of {n}",
    // alternative chooser + notices
    "mutex.note":
      "These are <b>mutually exclusive</b> — the method with the most recent successful run is the one in use for this group.",
    "alt.inUse": "IN USE",
    "altnote.current":
      "✓ In use — this method holds the most recent successful run for this group.",
    "altnote.runningInUse":
      "● Running — {label} stays in use until this run succeeds.",
    "altnote.runningNew":
      "● Running — this becomes the method in use if the run succeeds.",
    "altnote.superseded":
      "⊘ Superseded — {label} is in use for this group (most recent successful run).",
    // run row
    "run.locked": "🔒 Locked",
    "run.runFirst": "Run <b>{list}</b> first.",
    "run.running": "⟳ Running…",
    "run.previewConfig": "Preview config",
    "run.rerun": "↻ Re-run",
    "run.rerunSelected": "↻ Re-run selected method",
    "run.run": "▶ Run pipeline",
    "run.runSelected": "▶ Run selected method",
    // status pill
    "statuspill.openRun": "Open this run in OpenHEXA",
    // parameter form chrome (labels/help themselves stay English this phase)
    "form.noParams": "This pipeline takes no parameters.",
    "form.required": "Required",
    "form.selectEmpty": "— select —",
    "form.selectConn": "— select connection —",
    "form.connPlaceholder": "connection slug (e.g. dhis2-nmdr-drc)",
    "form.commaSep": "comma-separated",
    "form.filePath": "workspace file path (optional)",
    // validation
    "val.selectAtLeastOne": "{label} — select at least one",
    "val.required": "{label} is required",
    "val.wholeNumber": "{label} must be a whole number",
    "val.number": "{label} must be a number",
    // preview / run banners
    "preview.fixHeader": "Fix these before running:",
    "preview.configSoFar": "config so far:",
    "run.fixFields": "Fix the highlighted fields, then run again.",
    // run lifecycle
    "runstat.queued": "Queued…",
    "runstat.running": "Running…",
    "runstat.terminating": "Stopping…",
    "runstat.success": "Completed successfully",
    "runstat.failed": "Run failed",
    "runstat.stopped": "Run stopped",
    "runstat.skipped": "Run skipped",
    "runstat.viewRun": "view run ↗",
    // run flow messages
    "msg.runOnlyInOH": "Running a pipeline only works inside OpenHEXA.",
    "msg.notAvailableWs": "This pipeline isn’t available in this workspace.",
    "msg.startingRun": "Starting run…",
    "msg.couldntStart": "Couldn’t start the run: ",
    "msg.runNotAccepted": "the run was not accepted.",
    // runPipeline rejection — one message per PipelineError enum cause. The
    // first four mean the catalogue no longer matches what's installed.
    "runerr.invalidConfig":
      "OpenHEXA rejected these settings. This pipeline’s parameters have most likely changed since this workspace’s catalogue was built.",
    "runerr.noParameters":
      "this pipeline doesn’t accept parameters, but the form sent some — the catalogue is out of step with what’s installed.",
    "runerr.pipelineNotFound":
      "OpenHEXA no longer recognises this pipeline. It may have been removed or re-created since the catalogue was built.",
    "runerr.versionNotFound":
      "this pipeline has no deployed version in this workspace, so there is nothing to run.",
    "runerr.permissionDenied": "you don’t have permission to run this pipeline.",
    "runerr.runsLimit": "this workspace has reached its limit for pipeline runs.",
    "runerr.generic": "OpenHEXA refused it ({codes}).",
    "runerr.refreshHint":
      "Re-run “create_pipeline_cards” to refresh the catalogue, then reload this page.",
    "link.refreshCatalogue": "Open create_pipeline_cards ↗",
    "msg.unknownError": "unknown error",
    "msg.lostTrack": "Lost track of the run — check it in OpenHEXA.",
    "msg.stoppedWatchingStillRunning":
      "(stopped watching — still running in OpenHEXA)",
    "msg.stoppedWatching": "Stopped watching the run — check it in OpenHEXA.",
    "msg.couldntOpenFile": "Could not open this output file.",
    // outputs
    "out.noOutputsYet": "No outputs yet — this pipeline hasn’t run.",
    "out.onlyInOH": "Outputs are only available inside OpenHEXA.",
    "out.loading": "loading outputs…",
    "out.couldntLoad": "Couldn’t load outputs.",
    "out.dataset": "output dataset",
    "out.htmlReport": "HTML report",
    "out.outputFile": "output file",
    "out.output": "output",
    "out.noLinkable": "This run produced no linkable outputs.",
    // report embed
    "report.showPreview": "Show preview",
    "report.hidePreview": "Hide preview",
    "report.loading": "loading report…",
    "report.couldntPreview": "Couldn’t load the preview here. ",
    "report.openNewTab": "Open in a new tab ↗",
    // external links
    "link.readmeGithub": "README on GitHub",
    "link.seeWhat": "see what this pipeline does",
    "link.installTemplates": "Install from pipeline templates",
    "link.browseTemplates":
      "browse the available SNT templates in OpenHEXA",
    // missing / not-installed panel
    "missing.title": "This pipeline isn’t installed in this workspace yet.",
    "missing.body":
      "It’s part of the standard SNT pipeline map, but it hasn’t been added to {slug}. Install it from the OpenHEXA pipeline templates below, then reload this page — it’ll become active and runnable here.",
    "missing.thisWorkspace": "this workspace",
    "missing.templatesOnlyInOH":
      "The link to the templates page is only available when this app is opened inside OpenHEXA.",
    // boot / fatal
    "boot.loading": "Loading pipelines…",
    "boot.failed": "Couldn’t load the pipeline data.",
    "boot.unknownError": "Unknown error",
    "boot.noSteps": "No steps to show.",
    "boot.noWorkspace":
      "The workspace couldn’t be resolved — open this app from inside OpenHEXA.",
    "boot.cardsMissing":
      "No pipeline catalogue was found in this workspace ({key}). Run the “create_pipeline_cards” pipeline to generate it.",
    "boot.cardsUnreadable":
      "The pipeline catalogue in this workspace couldn’t be read ({key} — HTTP {status}). If it has never been generated, run the “create_pipeline_cards” pipeline.",
    // boot / no catalogue — one per diagnosed cause (diagnoseMissingCatalog)
    "boot.generatorNotInstalled":
      "This workspace has no pipeline catalogue yet, and the “create_pipeline_cards” pipeline that generates it isn’t installed here.",
    "boot.generatorNeverRun":
      "The “create_pipeline_cards” pipeline is installed in this workspace but has never run, so there is no catalogue yet.",
    "boot.generatorInProgress":
      "The “create_pipeline_cards” pipeline is running right now. Reload this page once it has finished.",
    "boot.generatorLastRunFailed":
      "The most recent “create_pipeline_cards” run ({status}) didn’t produce a catalogue.",
    "link.installGenerator": "Install it from the pipeline templates ↗",
    "link.runGenerator": "Open the pipeline and run it ↗",
    "link.openGeneratorRun": "Open the run ↗",
  },
  fr: {
    // static shell
    workspaceWord: "Espace de travail :",
    back: "Retour",
    next: "Suivant",
    // status labels
    "status.ok": "Réussi",
    "status.fail": "Échoué",
    "status.run": "En cours…",
    "status.none": "Jamais exécuté",
    "status.missing": "Non installé",
    "status.locked": "Verrouillé",
    // tracks
    "track.A": "Piste A · Données de surveillance de routine",
    "track.B": "Piste B · Géo & raster",
    "track.C": "Piste C · Enquêtes DHS",
    "track.D": "Piste D · Climat",
    "track.fallback": "Piste {t}",
    // stages (currently dormant — breadcrumb stage display is commented out)
    "stage.0": "Extraction",
    "stage.1": "Formatage",
    "stage.2": "Nettoyage & enrichissement",
    "stage.3": "Calcul",
    "stage.4": "Résultats",
    // alternative group titles
    "group.a3_outliers": "Imputation des valeurs aberrantes",
    "group.a4_reporting_rate": "Taux de complétude",
    "group.desc":
      "Choisissez une méthode, puis configurez-la et exécutez-la. La carte traite tout le groupe comme une seule étape — la méthode dont l’exécution réussie est la plus récente est celle utilisée en aval.",
    // node type chips
    "type.mandatory": "obligatoire",
    "type.alternative": "alternative",
    "type.facultative": "facultatif",
    // rail
    "rail.head": "Processus de stratification · {n} étapes",
    "rail.chooseOne": "en choisir une parmi {n}",
    // footer / appbar nav
    "foot.step": "Étape {n} sur {total}",
    // section headings
    "heading.chooseMethod": "Choisir une méthode",
    "heading.dependencies": "Dépendances",
    "heading.runParams": "Exécuter avec paramètres",
    "heading.latestOutputs": "Derniers résultats",
    "heading.more": "Plus",
    // dependency columns
    "dep.requires": "Requis (obligatoire)",
    "dep.uses": "Utilisé si disponible (optionnel)",
    "dep.unlocks": "Débloque la suite",
    "dep.none": "aucune",
    // chips
    "chip.notInstalled": "non installé",
    "chip.chooseNof": "en choisir 1 parmi {n}",
    // alternative chooser + notices
    "mutex.note":
      "Ces méthodes sont <b>mutuellement exclusives</b> — celle dont l’exécution réussie est la plus récente est celle utilisée pour ce groupe.",
    "alt.inUse": "UTILISÉ",
    "altnote.current":
      "✓ Utilisé — cette méthode détient l’exécution réussie la plus récente de ce groupe.",
    "altnote.runningInUse":
      "● En cours — {label} reste utilisé jusqu’à la réussite de cette exécution.",
    "altnote.runningNew":
      "● En cours — cette méthode sera utilisée si l’exécution réussit.",
    "altnote.superseded":
      "⊘ Remplacé — {label} est utilisé pour ce groupe (exécution réussie la plus récente).",
    // run row
    "run.locked": "🔒 Verrouillé",
    "run.runFirst": "Exécutez d’abord <b>{list}</b>.",
    "run.running": "⟳ En cours…",
    "run.previewConfig": "Aperçu de la config",
    "run.rerun": "↻ Relancer",
    "run.rerunSelected": "↻ Relancer la méthode choisie",
    "run.run": "▶ Exécuter le pipeline",
    "run.runSelected": "▶ Exécuter la méthode choisie",
    // status pill
    "statuspill.openRun": "Ouvrir cette exécution dans OpenHEXA",
    // parameter form chrome (labels/help themselves stay English this phase)
    "form.noParams": "Ce pipeline ne prend aucun paramètre.",
    "form.required": "Obligatoire",
    "form.selectEmpty": "— sélectionner —",
    "form.selectConn": "— sélectionner une connexion —",
    "form.connPlaceholder": "identifiant de connexion (ex. dhis2-nmdr-drc)",
    "form.commaSep": "séparés par des virgules",
    "form.filePath": "chemin du fichier dans l’espace de travail (optionnel)",
    // validation
    "val.selectAtLeastOne": "{label} — sélectionnez-en au moins un",
    "val.required": "{label} est obligatoire",
    "val.wholeNumber": "{label} doit être un nombre entier",
    "val.number": "{label} doit être un nombre",
    // preview / run banners
    "preview.fixHeader": "Corrigez ceci avant d’exécuter :",
    "preview.configSoFar": "config actuelle :",
    "run.fixFields": "Corrigez les champs en surbrillance, puis réessayez.",
    // run lifecycle
    "runstat.queued": "En file d’attente…",
    "runstat.running": "En cours…",
    "runstat.terminating": "Arrêt…",
    "runstat.success": "Terminé avec succès",
    "runstat.failed": "Échec de l’exécution",
    "runstat.stopped": "Exécution arrêtée",
    "runstat.skipped": "Exécution ignorée",
    "runstat.viewRun": "voir l’exécution ↗",
    // run flow messages
    "msg.runOnlyInOH": "L’exécution d’un pipeline ne fonctionne que dans OpenHEXA.",
    "msg.notAvailableWs": "Ce pipeline n’est pas disponible dans cet espace de travail.",
    "msg.startingRun": "Démarrage de l’exécution…",
    "msg.couldntStart": "Impossible de démarrer l’exécution : ",
    "msg.runNotAccepted": "l’exécution n’a pas été acceptée.",
    // rejet de runPipeline — un message par cause (enum PipelineError). Les
    // quatre premières signifient que le catalogue ne correspond plus.
    "runerr.invalidConfig":
      "OpenHEXA a rejeté ces paramètres. Les paramètres de ce pipeline ont très probablement changé depuis la génération du catalogue de cet espace de travail.",
    "runerr.noParameters":
      "ce pipeline n’accepte pas de paramètres, mais le formulaire en a envoyé — le catalogue ne correspond plus à ce qui est installé.",
    "runerr.pipelineNotFound":
      "OpenHEXA ne reconnaît plus ce pipeline. Il a peut-être été supprimé ou recréé depuis la génération du catalogue.",
    "runerr.versionNotFound":
      "ce pipeline n’a aucune version déployée dans cet espace de travail : il n’y a rien à exécuter.",
    "runerr.permissionDenied":
      "vous n’avez pas la permission d’exécuter ce pipeline.",
    "runerr.runsLimit":
      "cet espace de travail a atteint sa limite d’exécutions de pipelines.",
    "runerr.generic": "OpenHEXA l’a refusée ({codes}).",
    "runerr.refreshHint":
      "Réexécutez « create_pipeline_cards » pour actualiser le catalogue, puis rechargez cette page.",
    "link.refreshCatalogue": "Ouvrir create_pipeline_cards ↗",
    "msg.unknownError": "erreur inconnue",
    "msg.lostTrack": "Exécution perdue de vue — vérifiez-la dans OpenHEXA.",
    "msg.stoppedWatchingStillRunning":
      "(suivi interrompu — toujours en cours dans OpenHEXA)",
    "msg.stoppedWatching":
      "Suivi de l’exécution interrompu — vérifiez-la dans OpenHEXA.",
    "msg.couldntOpenFile": "Impossible d’ouvrir ce fichier de résultat.",
    // outputs
    "out.noOutputsYet": "Aucun résultat pour l’instant — ce pipeline n’a pas été exécuté.",
    "out.onlyInOH": "Les résultats ne sont disponibles que dans OpenHEXA.",
    "out.loading": "chargement des résultats…",
    "out.couldntLoad": "Impossible de charger les résultats.",
    "out.dataset": "jeu de données de sortie",
    "out.htmlReport": "rapport HTML",
    "out.outputFile": "fichier de sortie",
    "out.output": "sortie",
    "out.noLinkable": "Cette exécution n’a produit aucun résultat consultable.",
    // report embed
    "report.showPreview": "Afficher l’aperçu",
    "report.hidePreview": "Masquer l’aperçu",
    "report.loading": "chargement du rapport…",
    "report.couldntPreview": "Impossible d’afficher l’aperçu ici. ",
    "report.openNewTab": "Ouvrir dans un nouvel onglet ↗",
    // external links
    "link.readmeGithub": "README sur GitHub",
    "link.seeWhat": "voir ce que fait ce pipeline",
    "link.installTemplates": "Installer depuis les modèles de pipeline",
    "link.browseTemplates":
      "parcourir les modèles SNT disponibles dans OpenHEXA",
    // missing / not-installed panel
    "missing.title": "Ce pipeline n’est pas encore installé dans cet espace de travail.",
    "missing.body":
      "Il fait partie de la carte standard des pipelines SNT, mais il n’a pas été ajouté à {slug}. Installez-le depuis les modèles de pipeline OpenHEXA ci-dessous, puis rechargez cette page — il deviendra actif et exécutable ici.",
    "missing.thisWorkspace": "cet espace de travail",
    "missing.templatesOnlyInOH":
      "Le lien vers la page des modèles n’est disponible que lorsque cette application est ouverte dans OpenHEXA.",
    // boot / fatal
    "boot.loading": "Chargement des pipelines…",
    "boot.failed": "Impossible de charger les données des pipelines.",
    "boot.unknownError": "Erreur inconnue",
    "boot.noSteps": "Aucune étape à afficher.",
    "boot.noWorkspace":
      "L’espace de travail n’a pas pu être identifié — ouvrez cette application depuis OpenHEXA.",
    "boot.cardsMissing":
      "Aucun catalogue de pipelines n’a été trouvé dans cet espace de travail ({key}). Exécutez le pipeline « create_pipeline_cards » pour le générer.",
    "boot.cardsUnreadable":
      "Le catalogue de pipelines de cet espace de travail n’a pas pu être lu ({key} — HTTP {status}). S’il n’a jamais été généré, exécutez le pipeline « create_pipeline_cards ».",
    // boot / pas de catalogue — un message par cause diagnostiquée
    "boot.generatorNotInstalled":
      "Cet espace de travail n’a pas encore de catalogue de pipelines, et le pipeline « create_pipeline_cards » qui le génère n’y est pas installé.",
    "boot.generatorNeverRun":
      "Le pipeline « create_pipeline_cards » est installé dans cet espace de travail mais n’a jamais été exécuté : il n’y a donc pas encore de catalogue.",
    "boot.generatorInProgress":
      "Le pipeline « create_pipeline_cards » est en cours d’exécution. Rechargez cette page une fois qu’il aura terminé.",
    "boot.generatorLastRunFailed":
      "La dernière exécution de « create_pipeline_cards » ({status}) n’a pas produit de catalogue.",
    "link.installGenerator": "L’installer depuis les modèles de pipelines ↗",
    "link.runGenerator": "Ouvrir le pipeline et l’exécuter ↗",
    "link.openGeneratorRun": "Ouvrir l’exécution ↗",
  },
};

// Populate the static shell text (header) + language-toggle active state.
// Called on boot and on every language switch.
function applyStaticI18n() {
  var wsWord = document.getElementById("wsWord");
  if (wsWord) wsWord.textContent = t("workspaceWord");
  var back = document.getElementById("backBtn");
  if (back) back.innerHTML = "&#9666; " + escapeHtml(t("back"));
  var next = document.getElementById("nextBtn");
  if (next) next.innerHTML = escapeHtml(t("next")) + " &#9656;";
  Array.prototype.forEach.call(
    document.querySelectorAll(".langbtn"),
    function (b) {
      var on = b.getAttribute("data-lang") === LANG;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    },
  );
}

/* ================================================================== *
 * App state
 * ================================================================== */
var APP = {
  map: null,
  cards: null,
  nodes: [],
  nodeById: {},
  edges: [],
  steps: [],
  cur: 0, // index into APP.steps of the focused step
  altSel: {}, // group id -> selected member node id
  // selectedId == the focused step's (member) node id. Used by the shared
  // run/poll/outputs helpers (setRunStatusLine, loadOutputs, finishRun).
  selectedId: null,
  statusByUuid: null, // uuid -> { code, run }
  connections: null, // ConnectionType -> [{slug, name}]
  activeRun: {}, // node id -> run id being polled
  groupInUse: {}, // group id -> in-use node id (latest success)
  lastSuccessAt: {}, // node id -> ms of most recent observed success
};

/* ================================================================== *
 * Dependency helpers (from edges)
 * ================================================================== */
function hardParents(id) {
  return APP.edges
    .filter(function (e) {
      return e.type !== "optional" && e.to === id;
    })
    .map(function (e) {
      return e.from;
    });
}
function softParents(id) {
  return APP.edges
    .filter(function (e) {
      return e.type === "optional" && e.to === id;
    })
    .map(function (e) {
      return e.from;
    });
}
function hardChildren(id) {
  return APP.edges
    .filter(function (e) {
      return e.type !== "optional" && e.from === id;
    })
    .map(function (e) {
      return e.to;
    });
}

/* ================================================================== *
 * Live state: run status, cockpit state, locking
 * ================================================================== */
function liveRunOf(node) {
  var e =
    node && node.uuid && APP.statusByUuid ? APP.statusByUuid[node.uuid] : null;
  return e ? e.run : null;
}

// Collapse the live run status into the cockpit's visual state vocabulary.
//   missing  = not installed in this workspace
//   none     = installed, never run
//   ok       = latest run succeeded
//   fail     = latest run failed / stopped / skipped
//   run      = latest run queued / running / terminating
function cockpitState(node) {
  if (!node.available) return "missing";
  var run = liveRunOf(node);
  if (!run) return "none";
  var s = run.status;
  if (s === "success") return "ok";
  if (s === "failed" || s === "stopped" || s === "skipped") return "fail";
  return "run"; // queued / running / terminating
}

function isSuccess(id) {
  var n = APP.nodeById[id];
  if (!n) return false;
  return cockpitState(n) === "ok";
}

/* Why a node is locked: every *hard* prerequisite must have a completed
 * (successful) run. Group-aware — bucket solid sources by their alternative
 * `group` (a non-grouped source is its own bucket of size 1) and require at
 * least one completed source per bucket. Returns an array of missing-bucket
 * labels, or null when nothing gates it. When status is unavailable (opened
 * outside OpenHEXA, or the status query was blocked) we don't gate — the whole
 * walkthrough stays explorable. */
function lockedReason(id) {
  if (!APP.statusByUuid) return null; // status unknown -> don't lock
  var buckets = {};
  hardParents(id).forEach(function (pid) {
    var pn = APP.nodeById[pid];
    var key = pn && pn.group ? "grp:" + pn.group : "id:" + pid;
    (buckets[key] = buckets[key] || []).push(pid);
  });
  var missing = [];
  Object.keys(buckets).forEach(function (key) {
    var srcs = buckets[key];
    var satisfied = srcs.some(function (pid) {
      return isSuccess(pid);
    });
    if (!satisfied) {
      var rep = APP.nodeById[srcs[0]];
      if (key.indexOf("grp:") === 0)
        missing.push(rep.code + " " + groupTitle(rep.group));
      else missing.push(rep.code + " " + pickLang(rep.label));
    }
  });
  return missing.length ? missing : null;
}

/* ================================================================== *
 * Walkthrough model — steps, stages, tracks, glyphs
 * ================================================================== */
// Track accent colors only; the human-readable track/status/stage names now
// live in the I18N table (see t("track.A"), t("status.ok"), etc.).
var TRK_COLOR = { A: "var(--A)", B: "var(--B)", C: "var(--C)", D: "var(--D)" };
var G = { ok: "✓", fail: "✕", run: "⟳", none: "○", missing: "⦸", locked: "🔒" };

// Localized status label for a cockpit state (missing/none/ok/fail/run/locked).
function statusLabel(state) {
  return t("status." + state);
}
// Localized stage label (dormant — breadcrumb stage display is commented out).
function stageLabelFor(row) {
  return t("stage." + row) || "";
}

function groupTitle(g) {
  var key = "group." + g;
  var v = (I18N[LANG] || I18N.en)[key] || I18N.en[key];
  return v != null ? v : g;
}
function trackColor(track) {
  return TRK_COLOR[track] || "var(--soft)";
}
function trackName(track) {
  return TRK_COLOR[track]
    ? t("track." + track)
    : t("track.fallback", { t: track });
}

// Build the ordered list of walkthrough steps, collapsing each alternative
// group into a single "choose one" step (in first-seen order).
function buildSteps() {
  var steps = [];
  var seen = {};
  APP.nodes.forEach(function (n) {
    if (n.group) {
      if (seen[n.group]) return;
      seen[n.group] = true;
      var members = APP.nodes.filter(function (m) {
        return m.group === n.group;
      });
      steps.push({
        kind: "group",
        group: n.group,
        code: n.code,
        title: groupTitle(n.group),
        track: n.track,
        members: members,
      });
    } else {
      steps.push({
        kind: "single",
        code: n.code,
        title: pickLang(n.label),
        track: n.track,
        node: n,
      });
    }
  });
  return steps;
}

// The node a group step currently points at (its selected member).
function memberOf(step) {
  return step.kind === "single"
    ? step.node
    : APP.nodeById[APP.altSel[step.group]];
}
function currentStep() {
  return APP.steps[APP.cur];
}
function currentMemberNode() {
  var s = currentStep();
  return s ? memberOf(s) : null;
}
function stepAvailable(step) {
  if (step.kind === "single") return step.node.available;
  return step.members.some(function (m) {
    return m.available;
  });
}

// Choose a sensible default selected member per group: the in-use member (most
// recent success) if any, else the first available member, else the first.
function defaultMemberFor(step) {
  var inUse = APP.groupInUse[step.group];
  if (inUse) return inUse;
  var avail = step.members.filter(function (m) {
    return m.available;
  });
  return (avail[0] || step.members[0]).id;
}
function initAltSel() {
  APP.steps.forEach(function (s) {
    if (s.kind === "group" && !APP.altSel[s.group]) {
      APP.altSel[s.group] = defaultMemberFor(s);
    }
  });
}
// After status loads, prefer the in-use (latest-success) member for each group.
function syncAltSelToInUse() {
  APP.steps.forEach(function (s) {
    if (s.kind === "group" && APP.groupInUse[s.group]) {
      APP.altSel[s.group] = APP.groupInUse[s.group];
    }
  });
}

// Aggregate a step's status for the rail glyph.
function stepStatus(step) {
  if (step.kind === "single") return cockpitState(step.node);
  var sts = step.members.map(cockpitState);
  if (sts.indexOf("ok") >= 0) return "ok";
  if (sts.indexOf("run") >= 0) return "run";
  if (
    sts.every(function (x) {
      return x === "missing";
    })
  )
    return "missing";
  if (sts.indexOf("fail") >= 0) return "fail";
  return "none";
}

/* ================================================================== *
 * Status + connections loading
 * ================================================================== */
async function loadStatuses() {
  var slug = workspaceSlug();
  if (!slug) return; // outside OpenHEXA — leave statusByUuid null

  var data;
  try {
    data = await gql(STATUS_QUERY, { ws: slug });
  } catch (err) {
    console.error("SNT Orchestrator (cockpit) — status query failed:", err);
    return;
  }

  var items = (data.pipelines && data.pipelines.items) || [];
  var byUuid = {};
  items.forEach(function (p) {
    var run =
      p.runs && p.runs.items && p.runs.items.length ? p.runs.items[0] : null;
    byUuid[p.id] = { code: p.code, run: run };
  });
  APP.statusByUuid = byUuid;
}

async function loadConnections() {
  var slug = workspaceSlug();
  if (!slug) return;
  var data;
  try {
    data = await gql(CONNECTIONS_QUERY, { ws: slug });
  } catch (err) {
    console.warn(
      "SNT Orchestrator (cockpit) — connections query unavailable (form falls back to text slug input):",
      err,
    );
    return;
  }
  var conns = (data.workspace && data.workspace.connections) || [];
  var byType = {};
  conns.forEach(function (c) {
    (byType[c.type] = byType[c.type] || []).push({
      slug: c.slug,
      name: c.name,
    });
  });
  APP.connections = byType;
}

/* ================================================================== *
 * Parameter form + config builder (shared runtime pattern)
 * ================================================================== */
function fieldId(key) {
  return "fld-" + key;
}

function connOptionsFor(ptype) {
  if (!APP.connections) return null;
  var enumType =
    ptype === "DHIS2Connection"
      ? "DHIS2"
      : ptype === "CustomConnection"
        ? "CUSTOM"
        : null;
  if (!enumType) return null;
  return APP.connections[enumType] || [];
}

function fieldControlHtml(p) {
  var id = fieldId(p.key);
  var ptype = p.type;

  if (p.multiple && p.choices && p.choices.length) {
    var defs = Array.isArray(p.default) ? p.default.map(String) : [];
    return (
      '<div class="fchecks">' +
      p.choices
        .map(function (c) {
          var v = String(c);
          return (
            '<label class="fcheck-sm"><input type="checkbox" class="finput-multi" value="' +
            escapeHtml(v) +
            '"' +
            (defs.indexOf(v) >= 0 ? " checked" : "") +
            "> " +
            escapeHtml(v) +
            "</label>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  if (p.choices && p.choices.length) {
    var dv =
      p.default !== undefined && p.default !== null ? String(p.default) : "";
    return (
      '<select id="' +
      id +
      '" class="finput">' +
      '<option value="">' + escapeHtml(t("form.selectEmpty")) + "</option>" +
      p.choices
        .map(function (c) {
          var v = String(c);
          return (
            '<option value="' +
            escapeHtml(v) +
            '"' +
            (v === dv ? " selected" : "") +
            ">" +
            escapeHtml(v) +
            "</option>"
          );
        })
        .join("") +
      "</select>"
    );
  }

  if (ptype === "DHIS2Connection" || ptype === "CustomConnection") {
    var conns = connOptionsFor(ptype);
    if (conns && conns.length) {
      return (
        '<select id="' +
        id +
        '" class="finput">' +
        '<option value="">' + escapeHtml(t("form.selectConn")) + "</option>" +
        conns
          .map(function (c) {
            return (
              '<option value="' +
              escapeHtml(c.slug) +
              '">' +
              escapeHtml(c.name || c.slug) +
              " (" +
              escapeHtml(c.slug) +
              ")</option>"
            );
          })
          .join("") +
        "</select>"
      );
    }
    return (
      '<input id="' +
      id +
      '" class="finput" type="text" placeholder="' +
      escapeHtml(t("form.connPlaceholder")) +
      '">'
    );
  }

  if (ptype === "bool") {
    return (
      '<input id="' +
      id +
      '" class="finput" type="checkbox"' +
      (p.default === true ? " checked" : "") +
      ">"
    );
  }

  if (ptype === "int" || ptype === "float") {
    var step = ptype === "int" ? "1" : "any";
    var nv =
      p.default !== undefined && p.default !== null
        ? escapeHtml(String(p.default))
        : "";
    return (
      '<input id="' +
      id +
      '" class="finput" type="number" step="' +
      step +
      '" value="' +
      nv +
      '">'
    );
  }

  if (p.multiple) {
    var mv = Array.isArray(p.default) ? p.default.join(", ") : "";
    return (
      '<input id="' +
      id +
      '" class="finput" type="text" placeholder="' +
      escapeHtml(t("form.commaSep")) +
      '" value="' +
      escapeHtml(mv) +
      '">'
    );
  }

  if (ptype === "File") {
    return (
      '<input id="' +
      id +
      '" class="finput" type="text" placeholder="' +
      escapeHtml(t("form.filePath")) +
      '">'
    );
  }

  var sv =
    p.default !== undefined && p.default !== null
      ? escapeHtml(String(p.default))
      : "";
  return (
    '<input id="' + id + '" class="finput" type="text" value="' + sv + '">'
  );
}

function paramsFormHtml(node) {
  var params = node.parameters || [];
  if (!params.length)
    return (
      '<p class="sb-muted">' + escapeHtml(t("form.noParams")) + "</p>"
    );

  var fields = params
    .map(function (p) {
      var req = p.required
        ? ' <span class="req" title="' +
          escapeHtml(t("form.required")) +
          '">*</span>'
        : "";
      var help = p.help
        ? '<div class="fhelp">' + escapeHtml(p.help) + "</div>"
        : "";
      var data =
        ' data-key="' +
        escapeHtml(p.key) +
        '" data-ptype="' +
        escapeHtml(p.type) +
        '"' +
        (p.multiple ? ' data-multiple="1"' : "") +
        (p.required ? ' data-required="1"' : "");

      if (p.type === "bool") {
        return (
          '<div class="field field-bool"' +
          data +
          ">" +
          '<label class="fcheck">' +
          fieldControlHtml(p) +
          '<span class="flabel-inline">' +
          escapeHtml(p.label || p.key) +
          req +
          "</span></label>" +
          help +
          "</div>"
        );
      }

      return (
        '<div class="field"' +
        data +
        ">" +
        '<label class="flabel" for="' +
        fieldId(p.key) +
        '">' +
        escapeHtml(p.label || p.key) +
        req +
        "</label>" +
        fieldControlHtml(p) +
        help +
        "</div>"
      );
    })
    .join("");

  return (
    '<form id="sb-form" class="sb-form" autocomplete="off">' +
    fields +
    "</form>"
  );
}

function buildConfig(node) {
  var form = document.getElementById("sb-form");
  var config = {};
  var errors = [];
  if (!form) return { config: config, errors: errors };

  (node.parameters || []).forEach(function (p) {
    var wrap = form.querySelector('.field[data-key="' + p.key + '"]');
    if (!wrap) return;
    var ptype = p.type;
    var label = p.label || p.key;

    if (ptype === "bool") {
      var cb = wrap.querySelector('input[type="checkbox"]');
      config[p.key] = !!(cb && cb.checked);
      return;
    }

    if (p.multiple && p.choices && p.choices.length) {
      var picked = Array.prototype.map.call(
        wrap.querySelectorAll(".finput-multi:checked"),
        function (el) {
          return el.value;
        },
      );
      if (picked.length) config[p.key] = picked;
      else if (p.required)
        errors.push(t("val.selectAtLeastOne", { label: label }));
      return;
    }

    if (p.multiple) {
      var rawmulti = (wrap.querySelector(".finput") || {}).value || "";
      var arr = rawmulti
        .split(",")
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
      if (arr.length) config[p.key] = arr;
      else if (p.required) errors.push(t("val.required", { label: label }));
      return;
    }

    var ctl = wrap.querySelector(".finput");
    var val = ctl ? String(ctl.value).trim() : "";
    if (val === "") {
      if (p.required) errors.push(t("val.required", { label: label }));
      return;
    }

    if (ptype === "int") {
      var iv = Number(val);
      if (!isFinite(iv) || Math.floor(iv) !== iv) {
        errors.push(t("val.wholeNumber", { label: label }));
        return;
      }
      config[p.key] = iv;
    } else if (ptype === "float") {
      var fv = Number(val);
      if (!isFinite(fv)) {
        errors.push(t("val.number", { label: label }));
        return;
      }
      config[p.key] = fv;
    } else {
      config[p.key] = val;
    }
  });

  return { config: config, errors: errors };
}

/* ================================================================== *
 * Rendering — left rail
 * ================================================================== */
function railRepNode(step) {
  return memberOf(step);
}

function renderRail() {
  var rail = document.getElementById("rail");
  if (!rail) return;
  var h =
    '<div class="railhead">' +
    escapeHtml(t("rail.head", { n: APP.steps.length })) +
    "</div>";
  var lastTrack = null;
  APP.steps.forEach(function (s, i) {
    if (s.track !== lastTrack) {
      lastTrack = s.track;
      h +=
        '<div class="grp"><div class="glabel"><span class="tk" style="background:' +
        trackColor(s.track) +
        '"></span>' +
        escapeHtml(trackName(s.track)) +
        "</div>";
    }
    var st = stepStatus(s);
    var rep = railRepNode(s);
    var avail = stepAvailable(s);
    var locked = avail ? lockedReason(rep.id) : null;
    var showLocked = locked && st === "none";
    var glyphState = !avail ? "missing" : showLocked ? "locked" : st;
    // In the rail the circle itself conveys the state, so "never run" and "not
    // installed" show an empty circle (no glyph); other states keep their glyph.
    var railGlyph =
      glyphState === "none" || glyphState === "missing" ? "" : G[glyphState];
    var cls =
      (i === APP.cur ? "here " : "") +
      (!avail ? "missing " : showLocked ? "locked " : "");
    var meta =
      s.kind === "group"
        ? '<div class="rmeta">' +
          escapeHtml(t("rail.chooseOne", { n: s.members.length })) +
          "</div>"
        : "";
    h +=
      '<div class="ritem ' +
      cls +
      '" data-step="' +
      i +
      '" style="--track:' +
      trackColor(s.track) +
      '" role="button" tabindex="0">' +
      '<span class="sg ' +
      glyphState +
      '">' +
      railGlyph +
      "</span>" +
      '<div style="min-width:0"><div class="rlabel">' +
      /* '<span class="rcode">' +
      escapeHtml(s.code) +
      "</span> " + */
      escapeHtml(s.title) +
      "</div>" +
      meta +
      "</div>" +
      (i === APP.cur ? '<span class="here-tag">🡄</span>' : "") +
      "</div>";
    var next = APP.steps[i + 1];
    if (!next || next.track !== s.track) h += "</div>";
  });
  rail.innerHTML = h;
}

/* ================================================================== *
 * Rendering — center cockpit
 * ================================================================== */
function statusPillHtml(node) {
  var base = cockpitState(node);
  var showLocked = base === "none" && lockedReason(node.id);
  var state = showLocked ? "locked" : base;
  var run = liveRunOf(node);
  var meta = "";
  if (!showLocked && run) {
    meta = " · " + fmtRunDate(run.executionDate);
    var dur = fmtDuration(run.duration);
    if (dur) meta += " · " + dur;
  }
  var inner =
    '<span class="sg ' +
    state +
    '">' +
    G[state] +
    "</span>" +
    escapeHtml(showLocked ? statusLabel("locked") : statusLabel(state)) +
    escapeHtml(meta);
  // When there's a run to link to, the whole pill becomes a link to that run's
  // OpenHEXA page (with an outlink glyph); otherwise it's a plain badge.
  var url = run ? runPageUrl(node, run) : null;
  if (url) {
    return (
      '<a class="statuspill ' +
      state +
      ' statuspill-link" href="' +
      escapeHtml(url) +
      '" target="_blank" rel="noopener noreferrer" title="' +
      escapeHtml(t("statuspill.openRun")) +
      '">' +
      inner +
      ' <span class="arr">↗</span></a>'
    );
  }
  return '<span class="statuspill ' + state + '">' + inner + "</span>";
}

// Dependency column (Requires / Uses if available / Unlocks next).
function depColHtml(lab, ids, soft) {
  if (!ids.length)
    return (
      '<div class="col"><div class="lab">' +
      escapeHtml(lab) +
      '</div><span class="none-note">' +
      escapeHtml(t("dep.none")) +
      "</span></div>"
    );
  return (
    '<div class="col"><div class="lab">' +
    escapeHtml(lab) +
    "</div>" +
    ids
      .map(function (id) {
        var p = APP.nodeById[id];
        if (!p) return "";
        var ps = cockpitState(p);
        return (
          '<span class="depchip ' +
          (soft ? "soft" : "") +
          '" data-goid="' +
          escapeHtml(id) +
          '" role="button" tabindex="0"><span class="sg ' +
          ps +
          '">' +
          G[ps] +
          '</span><span class="cd">' +
          escapeHtml(p.code) +
          "</span> " +
          escapeHtml(pickLang(p.label)) +
          "</span>"
        );
      })
      .join("") +
    "</div>"
  );
}

// The alternative chooser grid (inner HTML of #ck-alts-slot).
function altChooserInnerHtml(step) {
  return (
    '<div class="alts">' +
    step.members
      .map(function (m) {
        var ms = cockpitState(m);
        var sel = APP.altSel[step.group] === m.id;
        var greyed = !m.available;
        var run = liveRunOf(m);
        var when =
          run && run.executionDate
            ? " · " + fmtRunDate(run.executionDate).slice(5)
            : "";
        var inUse = APP.groupInUse[step.group] === m.id;
        return (
          '<div class="alt ' +
          (sel ? "sel " : "") +
          (greyed ? "greyed" : "") +
          '"' +
          (greyed
            ? ""
            : ' data-mid="' +
              escapeHtml(m.id) +
              '" data-group="' +
              escapeHtml(step.group) +
              '" role="button" tabindex="0"') +
          ">" +
          '<span class="radio"></span>' +
          '<div class="acode">' +
          escapeHtml(m.code) +
          '</div><div class="atitle">' +
          escapeHtml(pickLang(m.label).replace(/^.*?:\s*/, "")) +
          "</div>" +
          '<div class="adesc">' +
          mdLite(pickLang(m.description)) +
          "</div>" +
          '<div class="astat"><span class="sg ' +
          ms +
          '">' +
          G[ms] +
          "</span>" +
          escapeHtml(greyed ? statusLabel("missing") : statusLabel(ms)) +
          escapeHtml(greyed ? "" : when) +
          "</div>" +
          (inUse
            ? '<span class="inuse">' + escapeHtml(t("alt.inUse")) + "</span>"
            : "") +
          "</div>"
        );
      })
      .join("") +
    "</div>"
  );
}

// The alternative-group in-use / running / superseded notice.
function groupExclusionNoticeHtml(node) {
  if (!node || !node.group) return "";
  var inUseId = APP.groupInUse[node.group];
  var inUseNode = inUseId ? APP.nodeById[inUseId] : null;
  var run = liveRunOf(node);
  var inFlight = !!(run && run.status && !isRunFinished(run.status));

  if (inUseId && inUseId === node.id) {
    return (
      '<div class="sb-altnote is-current">' +
      t("altnote.current") +
      "</div>"
    );
  }
  if (inFlight) {
    return (
      '<div class="sb-altnote running">' +
      (inUseNode
        ? t("altnote.runningInUse", {
            label: escapeHtml(pickLang(inUseNode.label)),
          })
        : t("altnote.runningNew")) +
      "</div>"
    );
  }
  if (inUseId) {
    return (
      '<div class="sb-altnote superseded">' +
      t("altnote.superseded", {
        label: escapeHtml(inUseNode ? pickLang(inUseNode.label) : inUseId),
      }) +
      "</div>"
    );
  }
  return "";
}

// Run row markup (button + hint), gating on lock / in-flight / prior success.
function runRowHtml(node) {
  var state = cockpitState(node);
  var locked = state === "none" ? lockedReason(node.id) : null;
  var run = liveRunOf(node);
  var inFlight =
    !!APP.activeRun[node.id] ||
    (run && run.status && !isRunFinished(run.status));
  var isGroup = !!node.group;

  if (locked) {
    return (
      '<button type="button" id="sb-run" class="btn-primary is-busy" disabled>' +
      escapeHtml(t("run.locked")) +
      "</button>" +
      '<span class="runhint">' +
      t("run.runFirst", { list: escapeHtml(locked.join(", ")) }) +
      "</span>"
    );
  }
  if (inFlight) {
    return (
      '<button type="button" id="sb-run" class="btn-primary is-busy" disabled>' +
      escapeHtml(t("run.running")) +
      "</button>" +
      '<button type="button" id="sb-preview" class="btn-secondary">' +
      escapeHtml(t("run.previewConfig")) +
      "</button>"
    );
  }
  var label =
    state === "ok"
      ? isGroup
        ? t("run.rerunSelected")
        : t("run.rerun")
      : isGroup
        ? t("run.runSelected")
        : t("run.run");
  var cls = "btn-primary" + (state === "ok" ? " rerun" : "");
  return (
    '<button type="button" id="sb-run" class="' +
    cls +
    '">' +
    escapeHtml(label) +
    "</button>" +
    '<button type="button" id="sb-preview" class="btn-secondary">' +
    escapeHtml(t("run.previewConfig")) +
    "</button>"
  );
}

function extLinkHtml(href, icon, title, sub, arrow) {
  return (
    '<a class="extlink" href="' +
    escapeHtml(href) +
    '" target="_blank" rel="noopener noreferrer">' +
    '<span class="ic">' +
    icon +
    "</span>" +
    '<span class="extlink-txt">' +
    escapeHtml(title) +
    (sub ? "<small>" + escapeHtml(sub) + "</small>" : "") +
    "</span>" +
    '<span class="arr">' +
    (arrow || "↗") +
    "</span></a>"
  );
}

// Footer nav (Back / step counter / Next).
function footHtml(step) {
  return (
    '<div class="ck-foot">' +
    '<button class="fbtn" data-nav="back" type="button"' +
    (APP.cur === 0 ? " disabled" : "") +
    ">&#9666; " +
    escapeHtml(t("back")) +
    "</button>" +
    '<span class="fcenter">' +
    escapeHtml(
      t("foot.step", { n: APP.cur + 1, total: APP.steps.length }) +
        " · " +
        step.code +
        " " +
        step.title,
    ) +
    "</span>" +
    '<button class="fbtn primary" data-nav="next" type="button"' +
    (APP.cur === APP.steps.length - 1 ? " disabled" : "") +
    ">" +
    escapeHtml(t("next")) +
    " &#9656;</button>" +
    "</div>"
  );
}

function renderCockpit() {
  var ck = document.getElementById("cockpit");
  if (!ck) return;
  var step = currentStep();
  if (!step) {
    ck.innerHTML =
      '<div class="ck-boot">' + escapeHtml(t("boot.noSteps")) + "</div>";
    return;
  }
  var node = memberOf(step);
  APP.selectedId = node ? node.id : null;

  updateAppbarNav();

  var trackC = trackColor(step.track);
  var stageLabel = stageLabelFor(node ? node.row : 0);

  // --- Not-installed (greyed) step: lightweight panel, nav still works. ---
  if (!stepAvailable(step)) {
    ck.innerHTML =
      '<div class="ck-top" style="border-top:4px solid ' +
      trackC +
      '">' +
      '<div class="breadcrumb"><span class="tk" style="background:' +
      trackC +
      '"></span>' +
      escapeHtml(trackName(step.track)) +
      /* " · Stage: " +
      escapeHtml(stageLabel) + */
      "</div>" +
      "<h2>" +
      escapeHtml(/* step.code + " " + */ step.title) +
      "</h2>" +
      '<div class="chips"><span class="chip type">' +
      escapeHtml(t("chip.notInstalled")) +
      "</span></div>" +
      "</div>" +
      '<div class="ck-body">' +
      missingBodyHtml(node || step.members[0]) +
      "</div>" +
      footHtml(step);
    var wrap = document.querySelector(".cockpit-wrap");
    if (wrap) wrap.scrollTop = 0;
    return;
  }

  var typeLabel =
    step.kind === "group" ? t("type.alternative") : t("type." + node.type);
  var hp = hardParents(node.id);
  var sp = softParents(node.id);
  var hc = hardChildren(node.id);

  var altsHtml = "";
  if (step.kind === "group") {
    altsHtml =
      '<div class="sec"><h4>' +
      escapeHtml(t("heading.chooseMethod")) +
      "</h4>" +
      '<p class="mutex-note">' +
      t("mutex.note") +
      "</p>" +
      '<div id="ck-alts-slot">' +
      altChooserInnerHtml(step) +
      "</div></div>";
  }

  var desc =
    step.kind === "group" ? t("group.desc") : pickLang(node.description);

  var paramsTitle =
    t("heading.runParams") +
    (step.kind === "group"
      ? " · " + pickLang(node.label).replace(/^.*?:\s*/, "")
      : "");

  ck.innerHTML =
    '<div class="ck-top" style="border-top:4px solid ' +
    trackC +
    '">' +
    '<div class="breadcrumb"><span class="tk" style="background:' +
    trackC +
    '"></span>' +
    escapeHtml(trackName(step.track)) +
    /* " · Stage: " +
    escapeHtml(stageLabel) + */
    "</div>" +
    "<h2>" +
    escapeHtml(/* step.code + " " + */ step.title) +
    "</h2>" +
    (node && node.ohName
      ? '<div class="ck-ohname">OpenHEXA: ' + escapeHtml(node.ohName) + "</div>"
      : "") +
    '<div class="chips">' +
    '<span class="chip type">' +
    escapeHtml(typeLabel) +
    "</span>" +
    (step.kind === "group"
      ? '<span class="chip stage">' +
        escapeHtml(t("chip.chooseNof", { n: step.members.length })) +
        "</span>"
      : "") +
    '<span id="ck-statuspill-slot">' +
    statusPillHtml(node) +
    "</span>" +
    "</div>" +
    "</div>" +
    '<div class="ck-body">' +
    '<div id="sb-altnote-slot">' +
    groupExclusionNoticeHtml(node) +
    "</div>" +
    (desc ? '<p class="desc">' + mdLite(desc) + "</p>" : "") +
    '<div class="sb-links">' +
    extLinkHtml(
      githubFolderUrl(node.id),
      "▤",
      t("link.readmeGithub"),
      "snt_development / " + node.id,
    ) +
    "</div>" +
    '<div class="sec"><h4>' +
    escapeHtml(t("heading.dependencies")) +
    '</h4><div class="deps">' +
    depColHtml(t("dep.requires"), hp, false) +
    depColHtml(t("dep.uses"), sp, true) +
    depColHtml(t("dep.unlocks"), hc, false) +
    "</div></div>" +
    altsHtml +
    '<div class="sec"><h4>' +
    escapeHtml(paramsTitle) +
    "</h4>" +
    paramsFormHtml(node) +
    '<div class="runrow" style="margin-top:16px">' +
    runRowHtml(node) +
    "</div>" +
    '<div id="sb-runstatus" class="sb-runstatus" hidden></div>' +
    '<pre id="sb-config" class="sb-config" hidden></pre>' +
    "</div>" +
    '<div class="sec"><h4>' +
    escapeHtml(t("heading.latestOutputs")) +
    '</h4><div id="sb-outputs" class="outputs"></div></div>' +
    "</div>" +
    footHtml(step);

  var wrap2 = document.querySelector(".cockpit-wrap");
  if (wrap2) wrap2.scrollTop = 0;

  // Turn each labelled section (Dependencies, Choose a method, Parameters,
  // Latest outputs) into its own collapsible box. The description block above
  // Dependencies isn't a `.sec`, so it stays permanently open. Dependencies
  // starts collapsed (it's the tallest — PRODUCT_SPEC §8, Dependencies).
  makeSectionsCollapsible(ck, [t("heading.dependencies").toLowerCase()]);

  // If a run for this node is already in flight (navigated away + back), reflect
  // it: disable the button + show the live status line.
  if (APP.activeRun[node.id]) {
    var entry =
      APP.statusByUuid && node.uuid ? APP.statusByUuid[node.uuid] : null;
    var liveRun = entry ? entry.run : null;
    if (liveRun)
      setRunStatusLine(
        node.id,
        runStatusLineHtml(node, liveRun),
        runStatusCls(liveRun.status),
      );
  }

  // Load this node's latest outputs (guarded by APP.selectedId inside).
  loadOutputs(node, liveRunOf(node));
}

/* ------------------------------------------------------------------ *
 * Collapsible section boxes (cockpit panel). Wraps each `.sec` body so
 * its <h4> toggles it open/closed. Called once per panel render on the
 * fresh DOM; ids inside sections still resolve via getElementById, so
 * the run/status/outputs plumbing is unaffected.
 * ------------------------------------------------------------------ */
function setSecOpen(sec, open) {
  sec.setAttribute("data-open", open ? "1" : "0");
  sec.classList.toggle("is-collapsed", !open);
}

function makeSectionsCollapsible(root, collapsedPrefixes) {
  if (!root) return;
  var collapsed = (collapsedPrefixes || []).map(function (s) {
    return s.toLowerCase();
  });
  Array.prototype.forEach.call(root.querySelectorAll(".sec"), function (sec) {
    if (sec.getAttribute("data-collapsible") === "1") return;
    var h = sec.querySelector("h4");
    if (!h) return;
    sec.setAttribute("data-collapsible", "1");
    sec.classList.add("sec-collapsible");

    // Move everything after the <h4> into a body wrapper.
    var body = document.createElement("div");
    body.className = "sec-body";
    var n = h.nextSibling;
    while (n) {
      var next = n.nextSibling;
      body.appendChild(n);
      n = next;
    }
    sec.appendChild(body);

    // Make the header a keyboard-accessible toggle with a caret.
    h.classList.add("sec-toggle");
    h.setAttribute("role", "button");
    h.setAttribute("tabindex", "0");
    var caret = document.createElement("span");
    caret.className = "sec-caret";
    caret.setAttribute("aria-hidden", "true");
    h.insertBefore(caret, h.firstChild);

    var label = (h.textContent || "").trim().toLowerCase();
    var startOpen = !collapsed.some(function (p) {
      return label.indexOf(p) === 0;
    });
    setSecOpen(sec, startOpen);

    function toggle() {
      setSecOpen(sec, sec.getAttribute("data-open") !== "1");
    }
    h.addEventListener("click", toggle);
    h.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle();
      }
    });
  });
}

function missingBodyHtml(node) {
  var slug = workspaceSlug();
  var links = extLinkHtml(
    githubFolderUrl(node.id),
    "▤",
    t("link.readmeGithub"),
    t("link.seeWhat"),
  );
  if (slug) {
    var templatesUrl =
      appBaseUrl() + "/workspaces/" + slug + "/pipelines/?tab=templates";
    links += extLinkHtml(
      templatesUrl,
      "✚",
      t("link.installTemplates"),
      t("link.browseTemplates"),
    );
  }
  return (
    '<div class="sb-missing">' +
    "<p><strong>" +
    escapeHtml(t("missing.title")) +
    "</strong></p>" +
    "<p>" +
    t("missing.body", {
      slug: "<strong>" + escapeHtml(slug || t("missing.thisWorkspace")) + "</strong>",
    }) +
    "</p>" +
    "</div>" +
    (node.description
      ? '<p class="desc" style="margin-top:14px">' +
        mdLite(pickLang(node.description)) +
        "</p>"
      : "") +
    '<div class="sec" style="margin-top:14px"><h4>' +
    escapeHtml(t("heading.more")) +
    '</h4><div class="outputs">' +
    links +
    "</div></div>" +
    (slug
      ? ""
      : '<p class="sb-muted" style="margin-top:10px">' +
        escapeHtml(t("missing.templatesOnlyInOH")) +
        "</p>")
  );
}

// Refresh only the live/dynamic parts of the current panel (no form rebuild) —
// safe to call on every poll tick.
function updateLiveBits() {
  renderRail();
  var node = currentMemberNode();
  if (!node) return;
  var pill = document.getElementById("ck-statuspill-slot");
  if (pill) pill.innerHTML = statusPillHtml(node);
  var note = document.getElementById("sb-altnote-slot");
  if (note) note.innerHTML = groupExclusionNoticeHtml(node);
  var step = currentStep();
  var alts = document.getElementById("ck-alts-slot");
  if (alts && step && step.kind === "group")
    alts.innerHTML = altChooserInnerHtml(step);
}

function updateAppbarNav() {
  var sc = document.getElementById("stepcount");
  if (sc)
    sc.textContent = t("foot.step", {
      n: APP.cur + 1,
      total: APP.steps.length,
    });
  var b = document.getElementById("backBtn");
  if (b) b.disabled = APP.cur === 0;
  var n = document.getElementById("nextBtn");
  if (n) n.disabled = APP.cur === APP.steps.length - 1;
}

/* ================================================================== *
 * Navigation
 * ================================================================== */
function go(i) {
  if (i < 0 || i >= APP.steps.length) return;
  APP.cur = i;
  renderRail();
  renderCockpit();
}
function goById(id) {
  var n = APP.nodeById[id];
  if (!n) return;
  var i = APP.steps.findIndex(function (s) {
    return s.kind === "single" ? s.node.id === id : s.group === n.group;
  });
  if (i >= 0) go(i);
}
function pickAlt(group, id) {
  APP.altSel[group] = id;
  renderRail();
  renderCockpit();
}

// The Preview-config toggle (shared with the run flow).
function togglePreview() {
  var node = currentMemberNode();
  if (!node) return;
  var previewBtn = document.getElementById("sb-preview");
  var configBox = document.getElementById("sb-config");
  if (!previewBtn || !configBox) return;
  if (!configBox.hidden) {
    configBox.hidden = true;
    previewBtn.classList.remove("is-active");
    previewBtn.setAttribute("aria-pressed", "false");
    return;
  }
  var built = buildConfig(node);
  configBox.hidden = false;
  previewBtn.classList.add("is-active");
  previewBtn.setAttribute("aria-pressed", "true");
  if (built.errors.length) {
    configBox.className = "sb-config has-errors";
    configBox.textContent =
      "⚠ " +
      t("preview.fixHeader") +
      "\n  - " +
      built.errors.join("\n  - ") +
      "\n\n" +
      t("preview.configSoFar") +
      "\n" +
      JSON.stringify(built.config, null, 2);
  } else {
    configBox.className = "sb-config";
    configBox.textContent = JSON.stringify(built.config, null, 2);
  }
}

/* ================================================================== *
 * Outputs
 * ================================================================== */
async function loadOutputs(node, run) {
  var box = document.getElementById("sb-outputs");
  if (!box) return;

  if (!run) {
    box.innerHTML =
      '<p class="sb-muted">' + escapeHtml(t("out.noOutputsYet")) + "</p>";
    return;
  }
  var slug = workspaceSlug();
  if (!slug) {
    box.innerHTML =
      '<p class="sb-muted">' + escapeHtml(t("out.onlyInOH")) + "</p>";
    return;
  }

  box.innerHTML = '<p class="sb-muted">' + escapeHtml(t("out.loading")) + "</p>";

  var data;
  try {
    data = await gql(OUTPUTS_QUERY, { id: run.id });
  } catch (err) {
    console.error("SNT Orchestrator (cockpit) — outputs query failed:", err);
    if (APP.selectedId === node.id)
      box.innerHTML =
        '<p class="sb-muted">' + escapeHtml(t("out.couldntLoad")) + "</p>";
    return;
  }
  if (APP.selectedId !== node.id) return; // navigated away

  var pr = data.pipelineRun || {};
  var base = appBaseUrl();
  var html = "";

  var seen = {};
  (pr.datasetVersions || []).forEach(function (dv) {
    var ds = dv.dataset;
    if (!ds || !dv.id || seen[dv.id]) return;
    seen[dv.id] = true;
    var fromSlug = ds.workspace && ds.workspace.slug ? ds.workspace.slug : slug;
    var url =
      base +
      "/workspaces/" +
      slug +
      "/datasets/" +
      ds.slug +
      "/from/" +
      fromSlug +
      "/?version=" +
      encodeURIComponent(dv.id);
    html += extLinkHtml(url, "▥", ds.name || ds.slug, t("out.dataset"));
  });

  var htmlReports = [];
  (pr.outputs || []).forEach(function (o) {
    if (o.__typename === "BucketObject") {
      if (o.type === "DIRECTORY") return;
      var html_report = isHtmlKey(o.key);
      if (html_report) htmlReports.push({ key: o.key, name: o.name || o.key });
      html +=
        '<a class="extlink" href="#" data-objkey="' +
        escapeHtml(o.key) +
        '">' +
        '<span class="ic">' +
        (html_report ? "▦" : "▣") +
        "</span>" +
        '<span class="extlink-txt">' +
        escapeHtml(o.name || o.key) +
        "<small>" +
        escapeHtml(html_report ? t("out.htmlReport") : t("out.outputFile")) +
        "</small></span>" +
        '<span class="arr">↗</span></a>';
    } else if (o.__typename === "GenericOutput") {
      html += extLinkHtml(o.uri, "▣", o.genericName || o.uri, t("out.output"));
    }
  });

  if (!html)
    html = '<p class="sb-muted">' + escapeHtml(t("out.noLinkable")) + "</p>";
  box.innerHTML = html;

  Array.prototype.forEach.call(
    box.querySelectorAll("a[data-objkey]"),
    function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        openBucketObject(a.getAttribute("data-objkey"), a);
      });
    },
  );

  renderReportEmbeds(box, htmlReports, slug);
}

async function openBucketObject(key, a) {
  var slug = workspaceSlug();
  if (!slug) return;
  if (a && a.getAttribute("data-busy") === "1") return;

  var win = window.open("about:blank", "_blank");
  if (win) win.opener = null;
  if (a) {
    a.setAttribute("data-busy", "1");
    a.classList.add("busy");
  }

  try {
    var data = await gql(DOWNLOAD_MUTATION, {
      input: { workspaceSlug: slug, objectKey: key, forceAttachment: false },
    });
    var r = data.prepareObjectDownload;
    if (r && r.success && r.downloadUrl) {
      if (win) win.location = r.downloadUrl;
      else window.open(r.downloadUrl, "_blank", "noopener");
    } else {
      console.error(
        "SNT Orchestrator (cockpit) — prepareObjectDownload failed:",
        key,
        r,
      );
      if (win) win.close();
      alert(t("msg.couldntOpenFile"));
    }
  } catch (err) {
    console.error(
      "SNT Orchestrator (cockpit) — prepareObjectDownload error:",
      err,
    );
    if (win) win.close();
    alert(t("msg.couldntOpenFile"));
  } finally {
    if (a) {
      a.removeAttribute("data-busy");
      a.classList.remove("busy");
    }
  }
}

/* ------------------------------------------------------------------ *
 * Inline HTML-report preview (F6 embed — PRODUCT_SPEC §8, Embedded HTML report).
 * Option A: <iframe src={signed URL}>. GCS signed URLs send no
 * X-Frame-Options, so the report renders in-frame (probe-confirmed,
 * host storage.googleapis.com). Signed URLs expire (~1h), so we
 * (re)mint on demand each time a preview is opened, and keep the
 * ↗ link-out as a fallback.
 * ------------------------------------------------------------------ */
async function mintDownloadUrl(slug, key) {
  var data = await gql(DOWNLOAD_MUTATION, {
    input: { workspaceSlug: slug, objectKey: key, forceAttachment: false },
  });
  var r = data.prepareObjectDownload;
  return r && r.success && r.downloadUrl ? r.downloadUrl : null;
}

function wireReportOpenLink(container, key) {
  var a = container.querySelector(".sb-report-openlink");
  if (a)
    a.addEventListener("click", function (e) {
      e.preventDefault();
      openBucketObject(key, null);
    });
}

function renderReportEmbeds(box, reports, slug) {
  if (!box || !reports || !reports.length || !slug) return;

  reports.forEach(function (rep, idx) {
    var sec = document.createElement("div");
    sec.className = "sb-report-embed";

    var head = document.createElement("div");
    head.className = "sb-report-head";
    var title = document.createElement("span");
    title.className = "sb-report-title";
    title.innerHTML = '<span class="ic">▦</span>' + escapeHtml(rep.name);
    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn-secondary sb-report-toggle";
    head.appendChild(title);
    head.appendChild(toggle);
    sec.appendChild(head);

    var body = document.createElement("div");
    body.className = "sb-report-body";
    sec.appendChild(body);
    box.appendChild(sec);

    var loaded = false; // an iframe is currently mounted with a fresh URL
    var shown = false; // body is expanded

    function collapse() {
      shown = false;
      loaded = false;
      body.style.display = "none";
      body.innerHTML = "";
      toggle.textContent = t("report.showPreview");
      toggle.classList.remove("is-active");
    }

    async function expand() {
      shown = true;
      body.style.display = "";
      toggle.textContent = t("report.hidePreview");
      toggle.classList.add("is-active");
      if (loaded) return;
      body.innerHTML =
        '<p class="sb-muted">' + escapeHtml(t("report.loading")) + "</p>";

      var url = null;
      try {
        url = await mintDownloadUrl(slug, rep.key);
      } catch (err) {
        console.error(
          "SNT Orchestrator (cockpit) — report preview mint failed:",
          rep.key,
          err,
        );
      }
      if (!shown) return; // collapsed while minting

      if (!url) {
        body.innerHTML =
          '<p class="sb-muted">' +
          escapeHtml(t("report.couldntPreview")) +
          '<a href="#" class="sb-report-openlink">' +
          escapeHtml(t("report.openNewTab")) +
          "</a></p>";
        wireReportOpenLink(body, rep.key);
        return;
      }

      var frame = document.createElement("iframe");
      frame.className = "sb-report-frame";
      // Sandbox: allow the report's own scripts/styles to run, but isolate it
      // from the app. allow-same-origin is needed for many report bundles.
      frame.setAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-popups allow-forms allow-downloads",
      );
      frame.setAttribute("referrerpolicy", "no-referrer");
      frame.setAttribute("loading", "lazy");
      frame.src = url;

      var bar = document.createElement("div");
      bar.className = "sb-report-bar";
      bar.innerHTML =
        '<a href="#" class="sb-report-openlink">' +
        escapeHtml(t("report.openNewTab")) +
        "</a>";

      body.innerHTML = "";
      body.appendChild(frame);
      body.appendChild(bar);
      wireReportOpenLink(bar, rep.key);
      loaded = true;
    }

    toggle.addEventListener("click", function () {
      if (shown) collapse();
      else expand();
    });

    // Auto-open the first report so the result is visible without a click.
    if (idx === 0) expand();
    else collapse();
  });
}

/* ================================================================== *
 * Run + poll
 * ================================================================== */
var POLL_INTERVAL_MS = 5000;
var POLL_MAX_ATTEMPTS = 480;

function isRunFinished(status) {
  return (
    status === "success" ||
    status === "failed" ||
    status === "stopped" ||
    status === "skipped"
  );
}

function runPageUrl(node, run) {
  var slug = workspaceSlug();
  var entry =
    APP.statusByUuid && node.uuid ? APP.statusByUuid[node.uuid] : null;
  var code = entry && entry.code ? entry.code : null;
  if (!slug || !code || !run || !run.id) return null;
  return (
    appBaseUrl() +
    "/workspaces/" +
    slug +
    "/pipelines/" +
    code +
    "/runs/" +
    run.id +
    "/"
  );
}

// Fold a fresh run into the status snapshot, track successes for mutual
// exclusion, then refresh the live (non-form) parts of the UI.
function applyRunToNode(node, run) {
  if (!APP.statusByUuid) APP.statusByUuid = {};
  var prev = APP.statusByUuid[node.uuid] || {};
  APP.statusByUuid[node.uuid] = { code: prev.code || null, run: run };
  if (run && run.status === "success") {
    var d = parseRunDate(run.executionDate);
    APP.lastSuccessAt[node.id] = d ? d.getTime() : Date.now();
  }
  computeGroupInUse();
  updateLiveBits();
}

function runStatusCls(status) {
  if (status === "success") return "rs-ok";
  if (status === "failed") return "rs-err";
  if (status === "stopped" || status === "skipped" || status === "terminating")
    return "rs-warn";
  return "rs-run";
}

function runStatusLineHtml(node, run) {
  var s = run.status;
  var glyph =
    s === "success"
      ? "✓"
      : s === "failed"
        ? "✕"
        : s === "stopped" || s === "skipped" || s === "terminating"
          ? "■"
          : "●";
  var label = I18N[LANG]["runstat." + s] != null ? t("runstat." + s) : s;
  var spin = s === "queued" || s === "running" ? " spin" : "";
  var url = runPageUrl(node, run);
  var link = url
    ? ' <a class="run-link" href="' +
      escapeHtml(url) +
      '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(t("runstat.viewRun")) +
      "</a>"
    : "";
  return (
    '<span class="rs-glyph' +
    spin +
    '">' +
    glyph +
    "</span> " +
    escapeHtml(label) +
    link
  );
}

function setRunStatusLine(nodeId, html, cls) {
  if (APP.selectedId !== nodeId) return;
  var box = document.getElementById("sb-runstatus");
  if (!box) return;
  box.hidden = false;
  box.className = "sb-runstatus" + (cls ? " " + cls : "");
  box.innerHTML = html;
}

function setRunBtnBusy(nodeId, busy) {
  if (APP.selectedId !== nodeId) return;
  var btn = document.getElementById("sb-run");
  if (!btn) return;
  btn.disabled = busy;
  btn.classList.toggle("is-busy", busy);
}

/* Map runPipeline's rejection to something the user can act on. `errors` is a
 * list of PipelineError *enum* values, not free text, so this is an exact match
 * rather than message-sniffing — it won't quietly stop working if OpenHEXA
 * rewords something. `drift: true` marks the causes that mean this workspace's
 * catalogue no longer matches the installed pipeline, which is exactly what
 * re-running the generator fixes. */
function runErrorInfo(errors) {
  var codes = (errors || []).map(function (e) {
    return String(e);
  });
  function has(code) {
    return codes.indexOf(code) !== -1;
  }

  if (has("INVALID_CONFIG"))
    return { text: t("runerr.invalidConfig"), drift: true };
  if (has("PIPELINE_DOES_NOT_SUPPORT_PARAMETERS"))
    return { text: t("runerr.noParameters"), drift: true };
  if (has("PIPELINE_NOT_FOUND"))
    return { text: t("runerr.pipelineNotFound"), drift: true };
  if (has("PIPELINE_VERSION_NOT_FOUND"))
    return { text: t("runerr.versionNotFound"), drift: true };
  if (has("PERMISSION_DENIED"))
    return { text: t("runerr.permissionDenied"), drift: false };
  if (has("PIPELINE_RUNS_LIMIT_REACHED"))
    return { text: t("runerr.runsLimit"), drift: false };
  if (codes.length)
    return {
      text: t("runerr.generic", { codes: codes.join(", ") }),
      drift: false,
    };
  return { text: t("msg.runNotAccepted"), drift: false };
}

/* The "this workspace's catalogue is stale — refresh it" tail for a run-status
 * line, with a link to the generator as it actually exists here (or to the
 * template if it isn't installed at all). Best-effort: if it can't be resolved,
 * keep the instruction and drop the link. */
async function catalogueRefreshHintHtml(slug) {
  var href = null;
  var d = await diagnoseMissingCatalog(slug);
  if (d && d.code) href = generatorPipelineUrl(slug, d.code);
  else if (d && d.state === "notInstalled") href = generatorTemplateUrl(slug);
  // state "unknown" -> no link; the instruction alone still says what to do.

  // The status line is a flex row, so the hint is its own full-width flex item
  // rather than a <br> (which wouldn't break the line inside a flex container).
  return (
    '<span class="rs-hint">' +
    escapeHtml(t("runerr.refreshHint")) +
    (href
      ? ' <a href="' +
        escapeHtml(href) +
        '" target="_blank" rel="noopener">' +
        escapeHtml(t("link.refreshCatalogue")) +
        "</a>"
      : "") +
    "</span>"
  );
}

async function runNode(node) {
  if (APP.activeRun[node.id]) return;

  var configBox = document.getElementById("sb-config");
  var built = buildConfig(node);
  if (built.errors.length) {
    if (configBox) {
      configBox.hidden = false;
      configBox.className = "sb-config has-errors";
      configBox.textContent =
        "⚠ " + t("preview.fixHeader") + "\n  - " + built.errors.join("\n  - ");
    }
    setRunStatusLine(
      node.id,
      '<span class="rs-glyph">⚠</span> ' + escapeHtml(t("run.fixFields")),
      "rs-err",
    );
    return;
  }

  var slug = workspaceSlug();
  if (!slug) {
    setRunStatusLine(
      node.id,
      '<span class="rs-glyph">⚠</span> ' + escapeHtml(t("msg.runOnlyInOH")),
      "rs-err",
    );
    return;
  }
  if (!node.uuid) {
    setRunStatusLine(
      node.id,
      '<span class="rs-glyph">⚠</span> ' + escapeHtml(t("msg.notAvailableWs")),
      "rs-err",
    );
    return;
  }

  APP.activeRun[node.id] = "starting";
  setRunBtnBusy(node.id, true);
  if (configBox) configBox.hidden = true;
  var previewBtn = document.getElementById("sb-preview");
  if (previewBtn) {
    previewBtn.classList.remove("is-active");
    previewBtn.setAttribute("aria-pressed", "false");
  }
  setRunStatusLine(
    node.id,
    '<span class="rs-glyph spin">●</span> ' + escapeHtml(t("msg.startingRun")),
    "rs-run",
  );

  var data;
  try {
    data = await gql(RUN_MUTATION, {
      input: { id: node.uuid, config: built.config },
    });
  } catch (err) {
    console.error("SNT Orchestrator (cockpit) — runPipeline error:", err);
    delete APP.activeRun[node.id];
    setRunBtnBusy(node.id, false);
    setRunStatusLine(
      node.id,
      '<span class="rs-glyph">⚠</span> ' +
        escapeHtml(t("msg.couldntStart") + (err.message || t("msg.unknownError"))),
      "rs-err",
    );
    return;
  }

  var rp = data && data.runPipeline;
  if (!rp || !rp.success || !rp.run || !rp.run.id) {
    var info = runErrorInfo(rp && rp.errors);
    delete APP.activeRun[node.id];
    setRunBtnBusy(node.id, false);
    var baseHtml =
      '<span class="rs-glyph">⚠</span> ' +
      escapeHtml(t("msg.couldntStart") + info.text);
    setRunStatusLine(node.id, baseHtml, "rs-err");
    // A stale catalogue is fixable, and the fix is a pipeline run — so point at
    // it. Added in a second pass so the error itself never waits on another
    // round trip (setRunStatusLine no-ops if another node is selected by then).
    if (info.drift)
      setRunStatusLine(
        node.id,
        baseHtml + (await catalogueRefreshHintHtml(slug)),
        "rs-err",
      );
    return;
  }

  var run = {
    id: rp.run.id,
    status: rp.run.status || "queued",
    executionDate: null,
    duration: null,
  };
  applyRunToNode(node, run);
  setRunStatusLine(
    node.id,
    runStatusLineHtml(node, run),
    runStatusCls(run.status),
  );
  pollRun(node, run.id);
}

function pollRun(node, runId) {
  APP.activeRun[node.id] = runId;
  var attempts = 0;

  function stop() {
    if (APP.activeRun[node.id] === runId) delete APP.activeRun[node.id];
    setRunBtnBusy(node.id, false);
  }

  function tick() {
    if (APP.activeRun[node.id] !== runId) return;
    gql(RUN_POLL_QUERY, { id: runId })
      .then(function (data) {
        if (APP.activeRun[node.id] !== runId) return;
        var pr = data && data.pipelineRun;
        if (!pr) {
          stop();
          setRunStatusLine(
            node.id,
            '<span class="rs-glyph">⚠</span> ' + escapeHtml(t("msg.lostTrack")),
            "rs-err",
          );
          return;
        }
        var run = {
          id: runId,
          status: pr.status,
          executionDate: pr.executionDate,
          duration: pr.duration,
        };
        applyRunToNode(node, run);
        setRunStatusLine(
          node.id,
          runStatusLineHtml(node, run),
          runStatusCls(pr.status),
        );

        if (isRunFinished(pr.status)) {
          stop();
          finishRun(node, run);
          return;
        }
        attempts++;
        if (attempts >= POLL_MAX_ATTEMPTS) {
          stop();
          setRunStatusLine(
            node.id,
            runStatusLineHtml(node, run) +
              " <small>" +
              escapeHtml(t("msg.stoppedWatchingStillRunning")) +
              "</small>",
            runStatusCls(pr.status),
          );
          return;
        }
        setTimeout(tick, POLL_INTERVAL_MS);
      })
      .catch(function (err) {
        if (APP.activeRun[node.id] !== runId) return;
        console.warn(
          "SNT Orchestrator (cockpit) — run poll error (will retry):",
          err,
        );
        attempts++;
        if (attempts >= POLL_MAX_ATTEMPTS) {
          stop();
          setRunStatusLine(
            node.id,
            '<span class="rs-glyph">⚠</span> ' +
              escapeHtml(t("msg.stoppedWatching")),
            "rs-err",
          );
          return;
        }
        setTimeout(tick, POLL_INTERVAL_MS);
      });
  }
  setTimeout(tick, 2500);
}

// Terminal status reached: re-render the panel (so the run-page link + outputs
// reflect the finished run) if the user is still on this step, then restore the
// completion line.
function finishRun(node, run) {
  if (APP.selectedId === node.id) {
    renderCockpit();
    setRunStatusLine(
      node.id,
      runStatusLineHtml(node, run),
      runStatusCls(run.status),
    );
  }
}

/* ================================================================== *
 * Mutual exclusion (alternative groups)
 * ================================================================== */
function seedGroupSuccessFromStatus() {
  if (!APP.statusByUuid) return;
  APP.nodes.forEach(function (n) {
    if (!(n.available && n.type === "alternative" && n.group)) return;
    var entry = APP.statusByUuid[n.uuid];
    var run = entry ? entry.run : null;
    if (run && run.status === "success") {
      var d = parseRunDate(run.executionDate);
      APP.lastSuccessAt[n.id] = d ? d.getTime() : 0;
    }
  });
}

// In use = the group member with the most recent observed success.
function computeGroupInUse() {
  var byGroup = {};
  APP.nodes.forEach(function (n) {
    if (n.type === "alternative" && n.group) {
      (byGroup[n.group] = byGroup[n.group] || []).push(n);
    }
  });
  Object.keys(byGroup).forEach(function (gid) {
    var inUseId = null;
    var best = -Infinity;
    byGroup[gid].forEach(function (n) {
      var t = APP.lastSuccessAt[n.id];
      if (t != null && t > best) {
        best = t;
        inUseId = n.id;
      }
    });
    APP.groupInUse[gid] = inUseId;
  });
}

/* ================================================================== *
 * Event wiring (delegation)
 * ================================================================== */
function wireEvents() {
  var rail = document.getElementById("rail");
  if (rail) {
    rail.addEventListener("click", function (e) {
      var it = e.target.closest(".ritem");
      if (it && it.dataset.step != null) go(+it.dataset.step);
    });
    rail.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var it = e.target.closest(".ritem");
      if (it && it.dataset.step != null) {
        e.preventDefault();
        go(+it.dataset.step);
      }
    });
  }

  var ck = document.getElementById("cockpit");
  if (ck) {
    ck.addEventListener("click", function (e) {
      var nav = e.target.closest("[data-nav]");
      if (nav) {
        go(nav.getAttribute("data-nav") === "next" ? APP.cur + 1 : APP.cur - 1);
        return;
      }
      var dep = e.target.closest("[data-goid]");
      if (dep) {
        goById(dep.getAttribute("data-goid"));
        return;
      }
      var alt = e.target.closest(".alt");
      if (alt && alt.dataset.mid && !alt.classList.contains("greyed")) {
        pickAlt(alt.getAttribute("data-group"), alt.getAttribute("data-mid"));
        return;
      }
      if (e.target.closest("#sb-run")) {
        var node = currentMemberNode();
        if (node) runNode(node);
        return;
      }
      if (e.target.closest("#sb-preview")) {
        togglePreview();
        return;
      }
    });
    ck.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var dep = e.target.closest("[data-goid]");
      if (dep) {
        e.preventDefault();
        goById(dep.getAttribute("data-goid"));
        return;
      }
      var alt = e.target.closest(".alt");
      if (alt && alt.dataset.mid && !alt.classList.contains("greyed")) {
        e.preventDefault();
        pickAlt(alt.getAttribute("data-group"), alt.getAttribute("data-mid"));
      }
    });
  }

  var backBtn = document.getElementById("backBtn");
  if (backBtn)
    backBtn.addEventListener("click", function () {
      go(APP.cur - 1);
    });
  var nextBtn = document.getElementById("nextBtn");
  if (nextBtn)
    nextBtn.addEventListener("click", function () {
      go(APP.cur + 1);
    });

  // Language toggle (EN / FR) in the app bar.
  Array.prototype.forEach.call(
    document.querySelectorAll(".langbtn"),
    function (b) {
      b.addEventListener("click", function () {
        setLang(b.getAttribute("data-lang"));
      });
    },
  );

  window.addEventListener("keydown", function (e) {
    var tag = document.activeElement ? document.activeElement.tagName : "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowRight") go(APP.cur + 1);
    if (e.key === "ArrowLeft") go(APP.cur - 1);
  });
}

/* ================================================================== *
 * Boot
 * ================================================================== */
async function init() {
  // Resolve language first, then paint the static shell in that language.
  LANG = currentLang();
  if (document.documentElement)
    document.documentElement.setAttribute("lang", LANG);
  applyStaticI18n();

  var wsLabel = document.getElementById("workspaceLabel");
  var slug = workspaceSlug();
  if (wsLabel) wsLabel.textContent = slug || "—";

  var ck = document.getElementById("cockpit");
  if (ck)
    ck.innerHTML =
      '<div class="ck-boot">' + escapeHtml(t("boot.loading")) + "</div>";

  try {
    var data = await loadData();
    APP.map = data.map;
    APP.cards = data.cards;
    APP.descriptions = data.descriptions;
    APP.nodes = mergeNodes(data.map, data.cards, data.descriptions);
    APP.nodeById = {};
    APP.nodes.forEach(function (n) {
      APP.nodeById[n.id] = n;
    });
    APP.edges = (data.map && data.map.edges) || [];
    APP.steps = buildSteps();
    initAltSel();

    wireEvents();
    renderRail();
    renderCockpit();

    // Live last-run status → drives greying-vs-run, locking, and mutual exclusion.
    await loadStatuses();
    seedGroupSuccessFromStatus();
    computeGroupInUse();
    syncAltSelToInUse();
    renderRail();
    renderCockpit();

    // Connections → real DHIS2Connection / CustomConnection dropdowns in the form.
    await loadConnections();
    renderCockpit();
  } catch (err) {
    console.error("SNT Orchestrator (cockpit) — failed to load:", err);
    if (ck)
      ck.innerHTML =
        '<div class="ck-boot">' +
        escapeHtml(t("boot.failed")) +
        "<br>" +
        // A diagnosed missing-catalogue error carries prebuilt (already
        // escaped) HTML so it can include an actionable link; anything else is
        // plain text and gets escaped here.
        (err && err.htmlMessage
          ? err.htmlMessage
          : escapeHtml(
              err && err.message ? err.message : t("boot.unknownError"),
            )) +
        "</div>";
  }
}

document.addEventListener("DOMContentLoaded", init);
