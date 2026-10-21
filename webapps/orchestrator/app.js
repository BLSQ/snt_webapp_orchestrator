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
// dropdowns in the form. Needs USER_READ, and the proxy currently refuses the
// nested fields anyway (OH-2); on failure the form falls back to a text slug input.
var CONNECTIONS_QUERY =
  "query ($ws: String!) {" +
  "  workspace(slug: $ws) {" +
  "    connections { id name slug type }" +
  "  }" +
  "}";

// pipelineRun bucket/generic file outputs for one run (PIPELINES_READ).
// outputs is a union, so use __typename inline fragments.
var OUTPUTS_QUERY =
  "query ($id: UUID!) {" +
  "  pipelineRun(id: $id) {" +
  "    outputs {" +
  "      __typename" +
  "      ... on BucketObject { key name type }" +
  "      ... on GenericOutput { uri genericName: name }" +
  "    }" +
  "  }" +
  "}";

// The run's dataset versions, queried separately: the proxy checks scopes per
// field and refuses the whole query if one field is denied, and DatasetVersion /
// Dataset fields need DATASETS_READ, which this app does not have (R9). So this
// query is best-effort and must never take the file outputs down with it.
// Dataset.workspace is never granted to webapps, so it is not asked for.
var DATASET_OUTPUTS_QUERY =
  "query ($id: UUID!) {" +
  "  pipelineRun(id: $id) {" +
  "    datasetVersions { id name dataset { slug name } }" +
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

// Stop a run. Needs PIPELINES_RUN. `errors` is the same PipelineError enum.
var STOP_MUTATION =
  "mutation ($input: StopPipelineInput!) {" +
  "  stopPipeline(input: $input) { success errors }" +
  "}";

// Poll one run for its live status (PIPELINES_READ).
var RUN_POLL_QUERY =
  "query ($id: UUID!) {" +
  "  pipelineRun(id: $id) {" +
  "    id status executionDate duration" +
  "  }" +
  "}";

// Used to find the generator and its state (see diagnoseMissingCatalog): every
// pipeline in the workspace with its most recent run, so we can find the
// generator and see whether it has ever run.
var GENERATOR_QUERY =
  "query ($ws: String!) {" +
  "  pipelines(workspaceSlug: $ws, page: 1, perPage: 100) {" +
  "    items {" +
  "      id" +
  "      code" +
  "      name" +
  "      runs(orderBy: EXECUTION_DATE_DESC, page: 1, perPage: 1) {" +
  "        items { id status executionDate }" +
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

/* Where the same pipeline writes each curated pipeline's README, as <id>.md,
 * copied from the deployed version's code (the proxy does not let webapps read
 * PipelineVersion.files — OH-3). Lockstep with config.py (OUTPUT_DIR +
 * README_DIR). */
var README_DIR_KEY = "utils_pipelines/create_pipeline_cards/pipeline_cards/readmes";

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
  if (!slug)
    throw new Error(t(isLocalDev() ? "boot.noWorkspaceLocal" : "boot.noWorkspace"));

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
 *   {state:"neverRun",      id, code}
 *   {state:"inProgress",    id, code, runId, status, executionDate}
 *   {state:"lastRunFailed", id, code, runId, status}
 *   {state:"unknown"}  — the probe itself failed, so stay generic rather than
 *                        assert something that might be wrong.
 * `id` is the pipeline UUID, what runPipeline needs to start it. */
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
  if (!last) return { state: "neverRun", id: found.id, code: found.code };
  if (RUN_ACTIVE_STATUSES.indexOf(String(last.status).toLowerCase()) !== -1)
    return {
      state: "inProgress",
      id: found.id,
      code: found.code,
      runId: last.id,
      status: last.status,
      executionDate: last.executionDate,
    };
  // Includes status "success": a successful run with no catalog still leaves
  // the app unbootable, and the run log is where the answer is.
  return {
    state: "lastRunFailed",
    id: found.id,
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

/* Markdown renderer for the pipeline READMEs (Documentation section). Covers
 * what the SNT READMEs use: headings, rules, nested bullet / numbered lists,
 * block quotes, fenced code, pipe tables, bold, italic, `code` and links.
 * Every piece of source text is escaped before any tag is added, so raw HTML
 * in a README shows as text; only http(s) links become <a> (relative links
 * point into the source repo, so they render as plain text). */
var MD_LIST = /^(\s*)([*+-]|\d+[.)])\s+(.*)$/;
var MD_HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
var MD_HEAD = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
var MD_FENCE = /^\s*(```|~~~)/;
var MD_TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function mdInline(text) {
  var codes = [];
  var s = text.replace(/`([^`]+)`/g, function (_, c) {
    codes.push("<code>" + escapeHtml(c) + "</code>");
    return "\u0000" + (codes.length - 1) + "\u0000";
  });
  s = escapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, url) {
    return /^https?:\/\//i.test(url)
      ? '<a href="' + url + '" target="_blank" rel="noopener">' + label + "</a>"
      : label;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*(?!\s)([^*]+?)\*(?!\w)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^\w])_(?!\s)([^_]+?)_(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, function (_, i) {
    return codes[+i];
  });
}

function mdIndent(line) {
  return line.match(/^\s*/)[0].replace(/\t/g, "    ").length;
}

function mdDedent(lines) {
  var min = Infinity;
  lines.forEach(function (l) {
    if (l.trim()) min = Math.min(min, mdIndent(l));
  });
  if (!isFinite(min)) return lines;
  return lines.map(function (l) {
    return l.replace(/\t/g, "    ").slice(Math.min(min, mdIndent(l)));
  });
}

function mdStartsBlock(line, next) {
  return (
    MD_HEAD.test(line) ||
    MD_HR.test(line) ||
    MD_FENCE.test(line) ||
    /^\s*>/.test(line) ||
    MD_LIST.test(line) ||
    (/^\s*\|/.test(line) && next !== undefined && MD_TABLE_SEP.test(next))
  );
}

function mdCells(row) {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map(function (c) {
      return c.trim();
    });
}

// A list block: items at the first item's indent become <li>; deeper lines
// (sub-lists, wrapped text) are rendered recursively inside the item.
function mdList(lines) {
  var base = mdIndent(lines[0]);
  var tag = /\d/.test(lines[0].match(MD_LIST)[2]) ? "ol" : "ul";
  var items = [];
  lines.forEach(function (l) {
    var m = l.match(MD_LIST);
    if (m && mdIndent(l) <= base) items.push({ head: m[3], body: [] });
    else if (items.length) items[items.length - 1].body.push(l);
  });
  return (
    "<" + tag + ">" +
    items
      .map(function (it) {
        var body = it.body.filter(function (l) {
          return l.trim();
        });
        // Wrapped text of the item itself joins its first line.
        var lazy = [];
        while (
          body.length &&
          !MD_LIST.test(body[0]) &&
          mdIndent(body[0]) <= base + 3 &&
          !mdStartsBlock(body[0].trim())
        )
          lazy.push(body.shift().trim());
        var head = [it.head].concat(lazy).join(" ");
        return (
          "<li>" + mdInline(head) + (body.length ? mdBlocks(mdDedent(body)) : "") + "</li>"
        );
      })
      .join("") +
    "</" + tag + ">"
  );
}

function mdBlocks(lines) {
  var out = [];
  var i = 0;
  var m;
  while (i < lines.length) {
    var line = lines[i];
    if (!line.trim()) {
      i++;
    } else if (MD_FENCE.test(line)) {
      var fence = line.trim().slice(0, 3);
      var code = [];
      i++;
      while (i < lines.length && lines[i].trim().indexOf(fence) !== 0) code.push(lines[i++]);
      i++;
      out.push("<pre><code>" + escapeHtml(code.join("\n")) + "</code></pre>");
    } else if ((m = line.match(MD_HEAD))) {
      out.push("<h" + m[1].length + ">" + mdInline(m[2]) + "</h" + m[1].length + ">");
      i++;
    } else if (MD_HR.test(line)) {
      out.push("<hr>");
      i++;
    } else if (/^\s*>/.test(line)) {
      var quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i]))
        quote.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push("<blockquote>" + mdBlocks(quote) + "</blockquote>");
    } else if (/^\s*\|/.test(line) && MD_TABLE_SEP.test(lines[i + 1] || "")) {
      var head = mdCells(line);
      var rows = [];
      i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(mdCells(lines[i++]));
      out.push(
        "<table><thead><tr>" +
          head
            .map(function (c) {
              return "<th>" + mdInline(c) + "</th>";
            })
            .join("") +
          "</tr></thead><tbody>" +
          rows
            .map(function (r) {
              return (
                "<tr>" +
                r
                  .map(function (c) {
                    return "<td>" + mdInline(c) + "</td>";
                  })
                  .join("") +
                "</tr>"
              );
            })
            .join("") +
          "</tbody></table>",
      );
    } else if (MD_LIST.test(line)) {
      var base = mdIndent(line);
      var block = [];
      while (i < lines.length) {
        var l = lines[i];
        if (!l.trim()) {
          // A blank line ends the list unless the list carries on after it.
          var nxt = lines[i + 1] || "";
          if (
            nxt.trim() &&
            (mdIndent(nxt) > base || (MD_LIST.test(nxt) && mdIndent(nxt) >= base))
          ) {
            block.push(l);
            i++;
            continue;
          }
          break;
        }
        if (mdIndent(l) < base) break;
        if (mdIndent(l) === base && !MD_LIST.test(l) && mdStartsBlock(l, lines[i + 1])) break;
        block.push(l);
        i++;
      }
      out.push(mdList(block));
    } else {
      var para = [];
      while (i < lines.length && lines[i].trim() && !mdStartsBlock(lines[i], lines[i + 1]))
        para.push(lines[i++].trim());
      out.push("<p>" + mdInline(para.join(" ")) + "</p>");
    }
  }
  return out.join("\n");
}

function renderMarkdown(md) {
  return mdBlocks(String(md).replace(/\r\n?/g, "\n").split("\n"));
}

// The main OpenHEXA front-end lives at app.openhexa.org (a different domain from
// the *.openhexa.io static-webapp host) — hardcoded for the SaaS.
function appBaseUrl() {
  return "https://app.openhexa.org";
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

// The time shown next to a run: OpenHEXA's `duration` once the run has
// finished; while in flight, the time elapsed since `executionDate` (computed
// here, refreshed on each poll tick). null — no time shown — for an in-flight
// run without an executionDate yet (e.g. queued), rather than a fake "0s".
function runTimeText(run) {
  if (!run) return null;
  if (isRunFinished(run.status)) return fmtDuration(run.duration);
  var d = parseRunDate(run.executionDate);
  return d ? fmtDuration((Date.now() - d.getTime()) / 1000) : null;
}

function isHtmlKey(key) {
  return /\.html?$/i.test(String(key || ""));
}

function workspaceSlug() {
  return window.OPENHEXA && window.OPENHEXA.workspaceSlug
    ? window.OPENHEXA.workspaceSlug
    : null;
}

// Same hosts as OpenHEXA's dev.js activates on (index.html). Used only to word
// the "no workspace" boot error for a local page that has not connected yet.
function isLocalDev() {
  return (
    window.location.protocol === "file:" ||
    ["localhost", "127.0.0.1", "::1", "[::1]"].indexOf(window.location.hostname) !== -1
  );
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
    "status.stop": "Stopped",
    "status.queue": "Queued",
    "status.run": "Running",
    "status.none": "Never run",
    "status.missing": "Not installed",
    "status.locked": "Installed · Locked",
    "legend.head": "Legend",
    "legend.installed": "Installed:",
    "legend.locked": "Locked — run its prerequisites first",
    // tracks
    "track.A": "Track A · Routine surveillance data",
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
    "heading.dependencies": "Before & after this step",
    "heading.runParams": "Run with Parameters",
    "heading.parameters": "Parameters",
    "heading.latestOutputs": "Latest outputs",
    "heading.documentation": "Documentation",
    "readme.loading": "Loading the documentation…",
    "readme.unavailable": "Documentation not available, re-run Create pipeline_cards.",
    // dependency columns
    "dep.requires": "Run first",
    "dep.uses": "Uses if available",
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
    "run.running": "Running…",
    "run.stop": "Stop",
    "run.stopping": "Stopping…",
    "run.previewConfig": "Preview config",
    "run.rerun": "Run again",
    "run.rerunSelected": "Run selected method again",
    "run.run": "Run",
    "run.runSelected": "Run selected method",
    // status pill
    "statuspill.openRun": "Open this run in OpenHEXA",
    // parameter form chrome (labels/help themselves stay English this phase)
    "form.noParams": "This pipeline takes no parameters.",
    "form.required": "Required",
    "form.selectEmpty": "— select —",
    "form.selectConn": "— select connection —",
    "form.connPlaceholder": "connection slug (e.g. dhis2-nmdr-drc)",
    "form.noConn": "No {type} connection in this workspace. Add one on the {link}, then reload this page.",
    "form.connTypeDhis2": "DHIS2",
    "form.connTypeCustom": "custom",
    "form.connSettingsWords": "OpenHEXA Connections page",
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
    "runstat.terminating": "Running…",
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
    "msg.couldntStop": "Couldn’t stop the run: ",
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
    "runerr.stopPermissionDenied": "you don’t have permission to stop this run.",
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
    // missing / not-installed panel
    "missing.title": "This pipeline isn’t installed in this workspace yet.",
    "missing.body":
      "It’s part of the standard SNT pipeline map, but it hasn’t been added to {slug}. To make it active and runnable here:",
    "missing.step1": "Install it from the {link}.",
    "missing.templatesWords": "OpenHEXA pipeline templates",
    "missing.step2":
      "Run “create_pipeline_cards” to refresh this workspace’s catalogue — installing alone isn’t enough.",
    "missing.step3": "Reload this page.",
    "missing.thisWorkspace": "this workspace",
    "missing.templatesOnlyInOH":
      "The pipeline templates link and the “Refresh the catalogue” button are only available when this app is opened inside OpenHEXA.",
    // step 2's "Refresh the catalogue" control (runs create_pipeline_cards)
    "genref.checking": "Checking “create_pipeline_cards”…",
    "genref.button": "↻ Refresh the catalogue",
    "genref.openInOH": "open in OpenHEXA ↗",
    "genref.notInstalled":
      "“create_pipeline_cards” isn’t installed in this workspace yet.",
    "genref.openPipelines": "Open the pipelines list in OpenHEXA ↗",
    "genref.starting": "Starting the refresh…",
    "genref.inProgress": "Refresh in progress…",
    "genref.success": "Catalogue refreshed.",
    "genref.failed": "The refresh didn’t complete.",
    "genref.reload": "↻ Reload page",
    // boot / fatal
    "boot.loading": "Loading pipelines…",
    "boot.failed": "Couldn’t load the pipeline data.",
    "boot.unknownError": "Unknown error",
    "boot.noSteps": "No steps to show.",
    "boot.noWorkspace":
      "The workspace couldn’t be resolved — open this app from inside OpenHEXA.",
    "boot.noWorkspaceLocal":
      "Running locally and not connected yet — click “Connect to OpenHEXA” (bottom right) and pick the orchestrator webapp of a workspace.",
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
    "status.stop": "Arrêté",
    "status.queue": "En file d’attente",
    "status.run": "En cours",
    "status.none": "Jamais exécuté",
    "status.missing": "Non installé",
    "status.locked": "Installé · Verrouillé",
    "legend.head": "Légende",
    "legend.installed": "Installé :",
    "legend.locked": "Verrouillé — exécutez d’abord ses prérequis",
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
    "heading.dependencies": "Avant et après cette étape",
    "heading.runParams": "Exécuter avec paramètres",
    "heading.parameters": "Paramètres",
    "heading.latestOutputs": "Derniers résultats",
    "heading.documentation": "Documentation",
    "readme.loading": "Chargement de la documentation…",
    "readme.unavailable": "Documentation non disponible, relancez Create pipeline_cards.",
    // dependency columns
    "dep.requires": "À exécuter avant",
    "dep.uses": "Utilisé si disponible",
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
    "run.running": "En cours…",
    "run.stop": "Arrêter",
    "run.stopping": "Arrêt en cours…",
    "run.previewConfig": "Aperçu de la config",
    "run.rerun": "Relancer",
    "run.rerunSelected": "Relancer la méthode choisie",
    "run.run": "Exécuter",
    "run.runSelected": "Exécuter la méthode choisie",
    // status pill
    "statuspill.openRun": "Ouvrir cette exécution dans OpenHEXA",
    // parameter form chrome (labels/help themselves stay English this phase)
    "form.noParams": "Ce pipeline ne prend aucun paramètre.",
    "form.required": "Obligatoire",
    "form.selectEmpty": "— sélectionner —",
    "form.selectConn": "— sélectionner une connexion —",
    "form.connPlaceholder": "identifiant de connexion (ex. dhis2-nmdr-drc)",
    "form.noConn": "Aucune connexion {type} dans cet espace de travail. Ajoutez-en une sur la {link}, puis rechargez cette page.",
    "form.connTypeDhis2": "DHIS2",
    "form.connTypeCustom": "personnalisée",
    "form.connSettingsWords": "page Connexions d’OpenHEXA",
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
    "runstat.terminating": "En cours…",
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
    "msg.couldntStop": "Impossible d’arrêter l’exécution : ",
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
    "runerr.stopPermissionDenied":
      "vous n’avez pas la permission d’arrêter cette exécution.",
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
    // missing / not-installed panel
    "missing.title": "Ce pipeline n’est pas encore installé dans cet espace de travail.",
    "missing.body":
      "Il fait partie de la carte standard des pipelines SNT, mais il n’a pas été ajouté à {slug}. Pour le rendre actif et exécutable ici :",
    "missing.step1": "Installez-le depuis les {link}.",
    "missing.templatesWords": "modèles de pipeline OpenHEXA",
    "missing.step2":
      "Exécutez « create_pipeline_cards » pour actualiser le catalogue de cet espace de travail — l’installation seule ne suffit pas.",
    "missing.step3": "Rechargez cette page.",
    "missing.thisWorkspace": "cet espace de travail",
    "missing.templatesOnlyInOH":
      "Le lien vers les modèles de pipeline et le bouton « Actualiser le catalogue » ne sont disponibles que lorsque cette application est ouverte dans OpenHEXA.",
    // contrôle « Actualiser le catalogue » de l’étape 2 (lance create_pipeline_cards)
    "genref.checking": "Vérification de « create_pipeline_cards »…",
    "genref.button": "↻ Actualiser le catalogue",
    "genref.openInOH": "ouvrir dans OpenHEXA ↗",
    "genref.notInstalled":
      "« create_pipeline_cards » n’est pas encore installé dans cet espace de travail.",
    "genref.openPipelines": "Ouvrir la liste des pipelines dans OpenHEXA ↗",
    "genref.starting": "Démarrage de l’actualisation…",
    "genref.inProgress": "Actualisation en cours…",
    "genref.success": "Catalogue actualisé.",
    "genref.failed": "L’actualisation n’a pas abouti.",
    "genref.reload": "↻ Recharger la page",
    // boot / fatal
    "boot.loading": "Chargement des pipelines…",
    "boot.failed": "Impossible de charger les données des pipelines.",
    "boot.unknownError": "Erreur inconnue",
    "boot.noSteps": "Aucune étape à afficher.",
    "boot.noWorkspace":
      "L’espace de travail n’a pas pu être identifié — ouvrez cette application depuis OpenHEXA.",
    "boot.noWorkspaceLocal":
      "Exécution locale, pas encore connectée — cliquez sur « Connect to OpenHEXA » (en bas à droite) et choisissez la webapp orchestrateur d’un espace de travail.",
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
  stopping: {}, // run id -> true once stopPipeline accepted it (until terminal)
  groupInUse: {}, // group id -> in-use node id (latest success)
  lastSuccessAt: {}, // node id -> ms of most recent observed success
  generator: null, // {id, code} of create_pipeline_cards once looked up (identity only)
  generatorLookup: false, // that lookup is in flight
  genRefresh: null, // the catalogue-refresh run this page is watching (resolveGeneratorRefresh)
  readmeById: {}, // node id -> README Markdown, once fetched (loadReadme)
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
//   fail     = latest run failed
//   stop     = latest run stopped / skipped
//   queue    = latest run queued
//   run      = latest run running / terminating
// "locked" is not returned here: it is a display state layered on "none"
// (installed, never run) by the renderers — never on "missing".
function cockpitState(node) {
  if (!node.available) return "missing";
  var run = liveRunOf(node);
  if (!run) return "none";
  var s = run.status;
  if (s === "success") return "ok";
  if (s === "failed") return "fail";
  if (s === "stopped" || s === "skipped") return "stop";
  if (s === "queued") return "queue";
  return "run"; // running / terminating
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
// Text colour that reads on each track colour (white or ink, see styles.css).
var TRK_INK = {
  A: "var(--A-ink)",
  B: "var(--B-ink)",
  C: "var(--C-ink)",
  D: "var(--D-ink)",
};
// Glyph text per state. Empty ones are drawn by CSS: the circle itself (none,
// missing, run — a pulsing dot in the pill) or a padlock mask (locked).
var G = {
  ok: "✓",
  fail: "✕",
  stop: "■",
  queue: "…",
  run: "",
  none: "",
  missing: "",
  locked: "",
};

// Localized status label for a cockpit state
// (missing/none/ok/fail/stop/queue/run/locked).
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
// Inline custom properties for a track-coloured element (group label,
// breadcrumb pill): --track and --track-ink.
function trackVars(track) {
  return (
    "--track:" + trackColor(track) + ";--track-ink:" + (TRK_INK[track] || "#fff")
  );
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
  if (sts.indexOf("queue") >= 0) return "queue";
  if (
    sts.every(function (x) {
      return x === "missing";
    })
  )
    return "missing";
  if (sts.indexOf("fail") >= 0) return "fail";
  if (sts.indexOf("stop") >= 0) return "stop";
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
  // A null workspace means the read did not succeed: leave APP.connections
  // unset so the form keeps the text input instead of claiming "no connection".
  if (!data || !data.workspace) {
    console.warn(
      "SNT Orchestrator (cockpit) — connections query returned no workspace (form falls back to text slug input).",
    );
    return;
  }
  var conns = data.workspace.connections || [];
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
    // Connections loaded but none of this type: say so instead of a bare
    // text box. No .finput here, so a required field fails validation.
    if (conns) {
      var slug = workspaceSlug();
      var settingsHtml = escapeHtml(t("form.connSettingsWords"));
      if (slug)
        settingsHtml =
          '<a href="' +
          escapeHtml(
            appBaseUrl() +
              "/workspaces/" +
              encodeURIComponent(slug) +
              "/connections/",
          ) +
          '" target="_blank" rel="noopener">' +
          settingsHtml +
          "</a>";
      return (
        '<div id="' +
        id +
        '" class="fnoconn">' +
        t("form.noConn", {
          type: escapeHtml(
            t(
              ptype === "DHIS2Connection"
                ? "form.connTypeDhis2"
                : "form.connTypeCustom",
            ),
          ),
          link: settingsHtml,
        }) +
        "</div>"
      );
    }
    // Connections query failed or not loaded yet: free-text slug.
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
        '<div class="grp" style="' +
        trackVars(s.track) +
        '"><div class="glabel">' +
        escapeHtml(trackName(s.track)) +
        "</div>";
    }
    var st = stepStatus(s);
    var rep = railRepNode(s);
    var avail = stepAvailable(s);
    var locked = avail ? lockedReason(rep.id) : null;
    var showLocked = locked && st === "none";
    var glyphState = !avail ? "missing" : showLocked ? "locked" : st;
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
      G[glyphState] +
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
  rail.innerHTML = h + railLegendHtml();
}

// Legend under the rail: "not installed" on its own, then every state an
// installed pipeline can be in (locked included), so locked never reads as
// "not installed".
function railLegendHtml() {
  function item(state, label) {
    return (
      '<div class="li"><span class="sg ' +
      state +
      '">' +
      G[state] +
      "</span>" +
      escapeHtml(label) +
      "</div>"
    );
  }
  return (
    '<div class="rail-legend"><div class="lh">' +
    escapeHtml(t("legend.head")) +
    "</div>" +
    item("missing", statusLabel("missing")) +
    item("none", t("legend.installed")) +
    '<div class="sub">' +
    item("none", statusLabel("none")) +
    item("locked", t("legend.locked")) +
    item("queue", statusLabel("queue")) +
    item("run", statusLabel("run")) +
    item("ok", statusLabel("ok")) +
    item("fail", statusLabel("fail")) +
    item("stop", statusLabel("stop")) +
    "</div></div>"
  );
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
    var dur = runTimeText(run);
    if (dur) meta += " · " + dur;
  }
  // "Never run" / "Not installed" are text only; other states lead with a bare
  // icon (CSS strips the circle; running is a pulsing dot).
  var icon =
    state === "none" || state === "missing"
      ? ""
      : '<span class="sg ' + state + '">' + G[state] + "</span>";
  var inner =
    icon +
    escapeHtml(statusLabel(state)) +
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

// Run-row button icons: OpenHEXA's heroicons (24px outline), drawn at 16px.
function btnIcon(d) {
  return (
    '<svg class="btn-ic" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"' +
    ' stroke-width="1.5" stroke="currentColor" aria-hidden="true">' +
    '<path stroke-linecap="round" stroke-linejoin="round" d="' +
    d +
    '"/></svg>'
  );
}
var ICON_PLAY = btnIcon(
  "M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z",
);
var ICON_RUN_AGAIN = btnIcon(
  "M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99",
);
var ICON_STOP = btnIcon(
  "M5.25 7.5A2.25 2.25 0 0 1 7.5 5.25h9a2.25 2.25 0 0 1 2.25 2.25v9a2.25 2.25 0 0 1-2.25 2.25h-9a2.25 2.25 0 0 1-2.25-2.25v-9Z",
);
var ICON_CODE = btnIcon(
  "M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5",
);

// The run being watched for a node, if it can be stopped: null while
// runPipeline has not returned an id yet, or when nothing is in flight.
function stoppableRunId(node) {
  if (APP.activeRun[node.id] === "starting") return null;
  var run = liveRunOf(node);
  return run && run.id && run.status && !isRunFinished(run.status)
    ? run.id
    : null;
}

// Run row markup (Run / Stop / Preview config + hint), gating on lock /
// in-flight / prior success. Rebuilt in place by refreshRunRow.
function runRowHtml(node) {
  var state = cockpitState(node);
  var locked = state === "none" ? lockedReason(node.id) : null;
  var run = liveRunOf(node);
  var inFlight =
    !!APP.activeRun[node.id] ||
    (run && run.status && !isRunFinished(run.status));
  var isGroup = !!node.group;
  var preview =
    '<button type="button" id="sb-preview" class="btn-quiet" aria-pressed="false">' +
    ICON_CODE +
    escapeHtml(t("run.previewConfig")) +
    "</button>";

  if (locked) {
    return (
      '<button type="button" id="sb-run" class="btn-primary" disabled>' +
      escapeHtml(t("run.locked")) +
      "</button>" +
      '<span class="runhint">' +
      t("run.runFirst", { list: escapeHtml(locked.join(", ")) }) +
      "</span>"
    );
  }
  if (inFlight) {
    var runId = stoppableRunId(node);
    var stopping =
      !!(runId && APP.stopping[runId]) || (run && run.status === "terminating");
    return (
      '<button type="button" id="sb-run" class="btn-primary" disabled>' +
      ICON_PLAY +
      escapeHtml(t("run.running")) +
      "</button>" +
      '<button type="button" id="sb-stop" class="btn-danger"' +
      (runId && !stopping ? "" : " disabled") +
      ">" +
      ICON_STOP +
      escapeHtml(t(stopping ? "run.stopping" : "run.stop")) +
      "</button>" +
      preview
    );
  }
  var again = state === "ok";
  var label = again
    ? isGroup
      ? t("run.rerunSelected")
      : t("run.rerun")
    : isGroup
      ? t("run.runSelected")
      : t("run.run");
  return (
    '<button type="button" id="sb-run" class="btn-primary">' +
    (again ? ICON_RUN_AGAIN : ICON_PLAY) +
    escapeHtml(label) +
    "</button>" +
    preview
  );
}

// Re-render the run row for the selected node, keeping the Preview-config
// toggle's pressed state (the config box itself lives outside the row).
// Skipped when nothing changed, so a poll tick doesn't steal button focus.
function refreshRunRow(nodeId) {
  if (APP.selectedId !== nodeId) return;
  var row = document.getElementById("sb-runrow");
  var node = APP.nodeById[nodeId];
  if (!row || !node) return;
  var html = runRowHtml(node);
  if (row._html === html) return;
  row._html = html;
  row.innerHTML = html;
  var configBox = document.getElementById("sb-config");
  var previewBtn = document.getElementById("sb-preview");
  if (previewBtn && configBox && !configBox.hidden) {
    previewBtn.classList.add("is-active");
    previewBtn.setAttribute("aria-pressed", "true");
  }
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
      ";" +
      trackVars(step.track) +
      '">' +
      '<div class="breadcrumb"><span class="trackpill">' +
      escapeHtml(trackName(step.track)) +
      "</span>" +
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
    resolveGeneratorRefresh(workspaceSlug());
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

  // Layout: the header carries the title (left) and the Dependencies box
  // (right); the body has the description, then one "Run with Parameters" box
  // holding Parameters (always open) and Documentation side by side.
  ck.innerHTML =
    '<div class="ck-top ck-top-split" style="border-top:4px solid ' +
    trackC +
    ";" +
    trackVars(step.track) +
    '">' +
    '<div class="ck-title">' +
    '<div class="breadcrumb"><span class="trackpill">' +
    escapeHtml(trackName(step.track)) +
    "</span>" +
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
    '<div class="sec"><h4>' +
    escapeHtml(t("heading.dependencies")) +
    '</h4><div class="deps">' +
    depColHtml(t("dep.requires"), hp, false) +
    depColHtml(t("dep.uses"), sp, true) +
    depColHtml(t("dep.unlocks"), hc, false) +
    "</div></div>" +
    "</div>" +
    '<div class="ck-body">' +
    '<div id="sb-altnote-slot">' +
    groupExclusionNoticeHtml(node) +
    "</div>" +
    (desc ? '<p class="desc">' + mdLite(desc) + "</p>" : "") +
    altsHtml +
    '<div class="sec"><h4>' +
    escapeHtml(paramsTitle) +
    "</h4>" +
    '<div class="run-grid">' +
    // Parameters is a .subbox, not a .sec, so it is never collapsible.
    '<div class="subbox"><h4>' +
    escapeHtml(t("heading.parameters")) +
    '</h4><div class="subbox-body">' +
    paramsFormHtml(node) +
    '<div id="sb-runrow" class="runrow" style="margin-top:16px">' +
    runRowHtml(node) +
    "</div>" +
    '<div id="sb-runstatus" class="sb-runstatus" hidden></div>' +
    '<pre id="sb-config" class="sb-config" hidden></pre>' +
    "</div></div>" +
    '<div class="sec" id="sb-readme-sec"><h4>' +
    escapeHtml(t("heading.documentation")) +
    '</h4><div id="sb-readme" class="sb-readme"></div></div>' +
    "</div>" +
    "</div>" +
    '<div class="sec"><h4>' +
    escapeHtml(t("heading.latestOutputs")) +
    '</h4><div id="sb-outputs" class="outputs"></div></div>' +
    "</div>" +
    footHtml(step);

  var wrap2 = document.querySelector(".cockpit-wrap");
  if (wrap2) wrap2.scrollTop = 0;

  // Turn each labelled section (Dependencies, Choose a method, Run with
  // Parameters, Documentation inside it, Latest outputs) into its own
  // collapsible box. The description block and the Parameters sub-box aren't
  // `.sec`s, so they stay permanently open.
  // Documentation, Dependencies and Run with Parameters start collapsed
  // (PRODUCT_SPEC §8, Dependencies). Prefix match, so a group step's
  // "Run with Parameters · <method>" counts too.
  makeSectionsCollapsible(ck, [
    t("heading.documentation").toLowerCase(),
    t("heading.dependencies").toLowerCase(),
    t("heading.runParams").toLowerCase(),
  ]);
  wireReadmeSection(node);

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
    // Own header only: sections nest (Documentation inside Run with Parameters).
    var h = sec.querySelector(":scope > h4");
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

/* ------------------------------------------------------------------ *
 * Documentation section: the pipeline's README, as deployed in this
 * workspace. create_pipeline_cards copies it to the bucket (README_DIR_KEY);
 * it is fetched the first time the section is opened, then kept in
 * APP.readmeById for the session (the README only changes when the
 * generator re-runs, which already needs a reload for the catalog).
 * ------------------------------------------------------------------ */
function wireReadmeSection(node) {
  var sec = document.getElementById("sb-readme-sec");
  var h = sec && sec.querySelector("h4");
  if (!h) return;
  function maybeLoad() {
    if (sec.getAttribute("data-open") === "1") loadReadme(node);
  }
  // Registered after makeSectionsCollapsible's toggle, so data-open is current.
  h.addEventListener("click", maybeLoad);
  h.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") maybeLoad();
  });
  maybeLoad();
}

async function loadReadme(node) {
  var box = document.getElementById("sb-readme");
  if (!box || box.getAttribute("data-state")) return;
  var md = APP.readmeById[node.id];
  if (md == null) {
    box.setAttribute("data-state", "loading");
    box.innerHTML = '<span class="sb-muted">' + escapeHtml(t("readme.loading")) + "</span>";
    try {
      var url = await mintDownloadUrl(workspaceSlug(), README_DIR_KEY + "/" + node.id + ".md");
      var res = url ? await fetch(url) : null;
      if (res && res.ok) md = APP.readmeById[node.id] = await res.text();
    } catch (e) {
      md = null;
    }
    // The user may have moved to another step while this was loading.
    if (APP.selectedId !== node.id || box !== document.getElementById("sb-readme")) return;
  }
  box.setAttribute("data-state", md == null ? "missing" : "loaded");
  box.innerHTML =
    md == null
      ? '<span class="sb-muted">' + escapeHtml(t("readme.unavailable")) + "</span>"
      : renderMarkdown(md);
}

function missingBodyHtml(node) {
  var slug = workspaceSlug();
  // Step 1's "OpenHEXA pipeline templates" is the templates link itself;
  // plain text outside OpenHEXA.
  var templatesHtml = escapeHtml(t("missing.templatesWords"));
  if (slug) {
    var templatesUrl =
      appBaseUrl() + "/workspaces/" + slug + "/pipelines/?tab=templates";
    templatesHtml =
      '<a href="' +
      escapeHtml(templatesUrl) +
      '" target="_blank" rel="noopener">' +
      templatesHtml +
      "</a>";
  }
  // Step 2's "Refresh the catalogue" control. Filled at once from the refresh
  // run this page is watching, if any; otherwise by resolveGeneratorRefresh()
  // once the generator lookup comes back.
  var refreshHtml = slug
    ? '<div id="sb-genrefresh" class="sb-genrefresh">' +
      (APP.genRefresh
        ? genRefreshRunHtml(APP.genRefresh)
        : '<span class="sb-muted">' + escapeHtml(t("genref.checking")) + "</span>") +
      "</div>"
    : "";
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
    "<ol>" +
    "<li>" +
    t("missing.step1", { link: templatesHtml }) +
    "</li>" +
    "<li>" +
    escapeHtml(t("missing.step2")) +
    refreshHtml +
    "</li>" +
    "<li>" +
    escapeHtml(t("missing.step3")) +
    "</li>" +
    "</ol>" +
    "</div>" +
    (node.description
      ? '<p class="desc" style="margin-top:14px">' +
        mdLite(pickLang(node.description)) +
        "</p>"
      : "") +
    (slug
      ? ""
      : '<p class="sb-muted" style="margin-top:10px">' +
        escapeHtml(t("missing.templatesOnlyInOH")) +
        "</p>")
  );
}

/* --- "Refresh the catalogue" (not-installed panel, step 2) ----------- *
 * The panel runs create_pipeline_cards itself (ADR 0015): it takes no
 * parameters and only rewrites the catalogue. What step 2 offers depends on
 * the generator's state, which changes, so it is looked up again on every
 * render of the panel and never cached. What is kept is the refresh run this
 * page started or picked up (APP.genRefresh: {id, code, phase, run, errors,
 * errorMessage}), so it survives re-renders. Phases: "starting", "watching",
 * then one of "done", "rejected", "lost", "gaveUp". */

// true = reload the page by itself once the refresh succeeds, instead of
// offering the Reload page button.
var GEN_REFRESH_AUTO_RELOAD = false;

function genRefreshEnded(g) {
  return g.phase !== "starting" && g.phase !== "watching";
}

function genRefreshButtonHtml() {
  return (
    '<button type="button" id="sb-genrefresh-btn" class="btn-primary">' +
    escapeHtml(t("genref.button")) +
    "</button>"
  );
}

function genRefreshLinkHtml(href, label) {
  return (
    '<a href="' +
    escapeHtml(href) +
    '" target="_blank" rel="noopener">' +
    escapeHtml(label) +
    "</a>"
  );
}

// Step 2 before any refresh run, from a fresh diagnoseMissingCatalog() result.
function genRefreshIdleHtml(d, slug) {
  if (d.state === "notInstalled")
    return (
      "<span>" +
      escapeHtml(t("genref.notInstalled")) +
      "</span> " +
      genRefreshLinkHtml(generatorTemplateUrl(slug), t("link.installGenerator"))
    );
  if (!d.code)
    // "unknown": the lookup failed, so offer the pipelines list (as before).
    return genRefreshLinkHtml(
      appBaseUrl() + "/workspaces/" + encodeURIComponent(slug) + "/pipelines/",
      t("genref.openPipelines"),
    );
  return (
    genRefreshButtonHtml() +
    genRefreshLinkHtml(generatorPipelineUrl(slug, d.code), t("genref.openInOH"))
  );
}

// Step 2 while / after a refresh run: a run-status line, plus Reload page
// after a success or the button again after a failed run.
function genRefreshRunHtml(g) {
  var slug = workspaceSlug();
  var run = g.run;
  var runUrl =
    slug && run && run.id ? generatorRunUrl(slug, g.code, run.id) : null;
  var runLink = runUrl
    ? ' <a class="run-link" href="' +
      escapeHtml(runUrl) +
      '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(t("runstat.viewRun")) +
      "</a>"
    : "";
  var glyph = "●";
  var spin = "";
  var cls = runStatusCls(run ? run.status : "queued");
  var text;
  var tail = "";
  var after = "";

  if (g.phase === "starting") {
    spin = " spin";
    cls = "rs-run";
    text = t("genref.starting");
  } else if (g.phase === "rejected" || g.phase === "lost") {
    glyph = "⚠";
    cls = "rs-err";
    text =
      g.phase === "lost"
        ? t("msg.lostTrack")
        : t("msg.couldntStart") +
          (g.errors
            ? runErrorInfo(g.errors).text
            : g.errorMessage || t("msg.unknownError"));
    if (slug && g.code)
      tail =
        ' <a class="run-link" href="' +
        escapeHtml(generatorPipelineUrl(slug, g.code)) +
        '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(t("link.refreshCatalogue")) +
        "</a>";
  } else if (g.phase === "done" && run.status === "success") {
    glyph = "✓";
    text = t("genref.success");
    tail = runLink;
    after =
      '<button type="button" id="sb-genrefresh-reload" class="btn-primary">' +
      escapeHtml(t("genref.reload")) +
      "</button>";
  } else if (g.phase === "done") {
    glyph = run.status === "failed" ? "✕" : "■";
    text = t("genref.failed");
    tail = runLink;
    after = genRefreshButtonHtml();
  } else {
    // watching / gaveUp: still in flight.
    spin = g.phase === "watching" ? " spin" : "";
    text = t("genref.inProgress");
    var time = runTimeText(run);
    tail =
      (time ? " <small>" + escapeHtml(time) + "</small>" : "") +
      runLink +
      (g.phase === "gaveUp"
        ? " <small>" + escapeHtml(t("msg.stoppedWatchingStillRunning")) + "</small>"
        : "");
  }

  return (
    '<div class="sb-runstatus ' +
    cls +
    '"><span class="rs-glyph' +
    spin +
    '">' +
    glyph +
    "</span> " +
    escapeHtml(text) +
    tail +
    "</div>" +
    after
  );
}

// Paint step 2's slot (if the not-installed panel is showing) and wire its
// buttons. With no html, paint the refresh run's state.
function paintGenRefresh(html) {
  var slot = document.getElementById("sb-genrefresh");
  if (!slot) return;
  if (html == null) {
    if (!APP.genRefresh) return;
    html = genRefreshRunHtml(APP.genRefresh);
  }
  slot.innerHTML = html;
  var btn = document.getElementById("sb-genrefresh-btn");
  if (btn) btn.addEventListener("click", startGeneratorRefresh);
  var reload = document.getElementById("sb-genrefresh-reload");
  if (reload)
    reload.addEventListener("click", function () {
      location.reload();
    });
}

/* Second pass for missingBodyHtml: look the generator up and fill step 2. The
 * slot is workspace-wide, so it doesn't matter which not-installed step is
 * showing by the time this resolves. */
async function resolveGeneratorRefresh(slug) {
  if (!slug || APP.genRefresh || APP.generatorLookup) return;
  APP.generatorLookup = true;
  var d = await diagnoseMissingCatalog(slug);
  APP.generatorLookup = false;
  // A refresh started meanwhile paints itself.
  if (APP.genRefresh) return;
  if (d.id) APP.generator = { id: d.id, code: d.code };
  if (d.state === "inProgress") {
    // Started elsewhere, or before a reload: watch it like our own.
    var g = (APP.genRefresh = { id: d.id, code: d.code });
    watchGeneratorRun(g, {
      id: d.runId,
      status: d.status,
      executionDate: d.executionDate,
      duration: null,
    });
    return;
  }
  paintGenRefresh(genRefreshIdleHtml(d, slug));
}

async function startGeneratorRefresh() {
  var gen = APP.generator;
  // One run at a time: a second click (or a click on a stale button) while a
  // refresh is starting or running does nothing.
  if (!gen || (APP.genRefresh && !genRefreshEnded(APP.genRefresh))) return;
  var g = (APP.genRefresh = { id: gen.id, code: gen.code, phase: "starting" });
  paintGenRefresh();

  var data;
  try {
    data = await gql(RUN_MUTATION, { input: { id: gen.id, config: {} } });
  } catch (err) {
    console.error("SNT Orchestrator (cockpit) — catalogue refresh error:", err);
    if (APP.genRefresh !== g) return;
    g.phase = "rejected";
    g.errorMessage = err.message;
    paintGenRefresh();
    return;
  }
  if (APP.genRefresh !== g) return;

  var rp = data && data.runPipeline;
  if (!rp || !rp.success || !rp.run || !rp.run.id) {
    g.phase = "rejected";
    g.errors = (rp && rp.errors) || [];
    paintGenRefresh();
    return;
  }
  watchGeneratorRun(g, {
    id: rp.run.id,
    status: rp.run.status || "queued",
    executionDate: null,
    duration: null,
  });
}

function watchGeneratorRun(g, run) {
  g.phase = "watching";
  g.run = run;
  paintGenRefresh();
  watchRun(run.id, {
    alive: function () {
      return APP.genRefresh === g;
    },
    update: function (r) {
      g.run = r;
      paintGenRefresh();
    },
    done: function (r) {
      g.phase = "done";
      paintGenRefresh();
      if (r.status === "success" && GEN_REFRESH_AUTO_RELOAD) location.reload();
    },
    lost: function () {
      g.phase = "lost";
      paintGenRefresh();
    },
    giveUp: function (r) {
      if (r) g.run = r;
      g.phase = "gaveUp";
      paintGenRefresh();
    },
  });
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

  var datasetsReq = gql(DATASET_OUTPUTS_QUERY, { id: run.id }).catch(
    function (err) {
      console.warn(
        "SNT Orchestrator (cockpit) — dataset outputs unavailable:",
        err,
      );
      return null;
    },
  );
  var data, dsData;
  try {
    data = await gql(OUTPUTS_QUERY, { id: run.id });
  } catch (err) {
    console.error("SNT Orchestrator (cockpit) — outputs query failed:", err);
    if (APP.selectedId === node.id)
      box.innerHTML =
        '<p class="sb-muted">' + escapeHtml(t("out.couldntLoad")) + "</p>";
    return;
  }
  dsData = await datasetsReq;
  if (APP.selectedId !== node.id) return; // navigated away

  var pr = data.pipelineRun || {};
  var dsRun = (dsData && dsData.pipelineRun) || {};
  var base = appBaseUrl();
  var html = "";

  var seen = {};
  (dsRun.datasetVersions || []).forEach(function (dv) {
    var ds = dv.dataset;
    if (!ds || !dv.id || seen[dv.id]) return;
    seen[dv.id] = true;
    // A run writes its datasets in its own workspace.
    var fromSlug = slug;
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
  if (status === "stopped" || status === "skipped") return "rs-stop";
  if (status === "queued") return "rs-queue";
  return "rs-run"; // running / terminating (OpenHEXA shows both as Running)
}

function runStatusLineHtml(node, run) {
  var s = run.status;
  var glyph =
    s === "success"
      ? "✓"
      : s === "failed"
        ? "✕"
        : s === "stopped" || s === "skipped"
          ? "■"
          : "●";
  var label = I18N[LANG]["runstat." + s] != null ? t("runstat." + s) : s;
  var spin =
    s === "queued" || s === "running" || s === "terminating" ? " spin" : "";
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

/* Where to send someone who needs to refresh the catalogue: the generator as it
 * actually exists here, or its template if it isn't installed at all. null when
 * the lookup failed. Costs one query. */
async function generatorRefreshUrl(slug) {
  var d = await diagnoseMissingCatalog(slug);
  if (d && d.code) return generatorPipelineUrl(slug, d.code);
  if (d && d.state === "notInstalled") return generatorTemplateUrl(slug);
  return null; // state "unknown"
}

/* The "this workspace's catalogue is stale — refresh it" tail for a run-status
 * line. Best-effort: if the generator can't be resolved, keep the instruction
 * and drop the link. */
async function catalogueRefreshHintHtml(slug) {
  // null -> no link; the instruction alone still says what to do.
  var href = await generatorRefreshUrl(slug);

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
  refreshRunRow(node.id);
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
    refreshRunRow(node.id);
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
    refreshRunRow(node.id);
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
  refreshRunRow(node.id); // the run id is known now, so Stop is enabled
}

/* Ask OpenHEXA to stop the node's in-flight run. On success the run goes
 * `terminating` -> `stopped`; the poll already watching it picks that up and
 * finishRun re-renders. ALREADY_COMPLETED / ALREADY_STOPPED need no message:
 * the next poll tick shows the terminal status. */
async function stopNode(node) {
  var runId = stoppableRunId(node);
  if (!runId || APP.stopping[runId]) return;

  APP.stopping[runId] = true;
  refreshRunRow(node.id);

  var errText = null;
  try {
    var data = await gql(STOP_MUTATION, { input: { runId: runId } });
    var sp = data && data.stopPipeline;
    if (!sp || !sp.success) {
      var codes = ((sp && sp.errors) || []).map(String);
      if (
        codes.indexOf("PIPELINE_ALREADY_COMPLETED") === -1 &&
        codes.indexOf("PIPELINE_ALREADY_STOPPED") === -1
      )
        errText =
          codes.indexOf("PERMISSION_DENIED") !== -1
            ? t("runerr.stopPermissionDenied")
            : codes.length
              ? t("runerr.generic", { codes: codes.join(", ") })
              : t("msg.unknownError");
    }
  } catch (err) {
    console.error("SNT Orchestrator (cockpit) — stopPipeline error:", err);
    errText = err.message || t("msg.unknownError");
  }

  if (errText == null) {
    // Nothing is polling this run (it should be, but don't leave Stop stuck).
    if (APP.activeRun[node.id] !== runId) pollRun(node, runId);
    return;
  }
  delete APP.stopping[runId];
  refreshRunRow(node.id);
  setRunStatusLine(
    node.id,
    '<span class="rs-glyph">⚠</span> ' +
      escapeHtml(t("msg.couldntStop") + errText),
    "rs-err",
  );
}

/* The poll loop, shared by node runs (pollRun) and the catalogue refresh
 * (watchGeneratorRun). Each tick asks `h.alive()` first and goes quiet when it
 * says no (someone else now owns the run). Callbacks:
 *   h.update(run) — every successful tick, finished or not
 *   h.done(run)   — the run reached a terminal status
 *   h.lost()      — the run no longer exists
 *   h.giveUp(run) — POLL_MAX_ATTEMPTS reached; `run` is null if the last tick
 *                   errored */
function watchRun(runId, h) {
  var attempts = 0;

  function again(run) {
    attempts++;
    if (attempts >= POLL_MAX_ATTEMPTS) h.giveUp(run);
    else setTimeout(tick, POLL_INTERVAL_MS);
  }

  function tick() {
    if (!h.alive()) return;
    gql(RUN_POLL_QUERY, { id: runId })
      .then(function (data) {
        if (!h.alive()) return;
        var pr = data && data.pipelineRun;
        if (!pr) {
          h.lost();
          return;
        }
        var run = {
          id: runId,
          status: pr.status,
          executionDate: pr.executionDate,
          duration: pr.duration,
        };
        h.update(run);
        if (isRunFinished(pr.status)) h.done(run);
        else again(run);
      })
      .catch(function (err) {
        if (!h.alive()) return;
        console.warn(
          "SNT Orchestrator (cockpit) — run poll error (will retry):",
          err,
        );
        again(null);
      });
  }
  setTimeout(tick, 2500);
}

function pollRun(node, runId) {
  APP.activeRun[node.id] = runId;

  function stop() {
    if (APP.activeRun[node.id] === runId) delete APP.activeRun[node.id];
    delete APP.stopping[runId];
    refreshRunRow(node.id);
  }

  watchRun(runId, {
    alive: function () {
      return APP.activeRun[node.id] === runId;
    },
    update: function (run) {
      applyRunToNode(node, run);
      setRunStatusLine(
        node.id,
        runStatusLineHtml(node, run),
        runStatusCls(run.status),
      );
      refreshRunRow(node.id); // e.g. `terminating` -> "Stopping…"
    },
    done: function (run) {
      stop();
      finishRun(node, run);
    },
    lost: function () {
      stop();
      setRunStatusLine(
        node.id,
        '<span class="rs-glyph">⚠</span> ' + escapeHtml(t("msg.lostTrack")),
        "rs-err",
      );
    },
    giveUp: function (run) {
      stop();
      if (run)
        setRunStatusLine(
          node.id,
          runStatusLineHtml(node, run) +
            " <small>" +
            escapeHtml(t("msg.stoppedWatchingStillRunning")) +
            "</small>",
          runStatusCls(run.status),
        );
      else
        setRunStatusLine(
          node.id,
          '<span class="rs-glyph">⚠</span> ' +
            escapeHtml(t("msg.stoppedWatching")),
          "rs-err",
        );
    },
  });
}

// After a reload, the latest run of a node can still be in flight with nothing
// watching it: pick polling back up so the pill keeps moving and turns ✓/✕ at
// the end. A resumed poll starts a fresh POLL_MAX_ATTEMPTS budget (APP-5).
function resumeInFlightPolls() {
  APP.nodes.forEach(function (n) {
    if (!n.uuid || APP.activeRun[n.id]) return;
    var run = liveRunOf(n);
    if (run && run.id && run.status && !isRunFinished(run.status))
      pollRun(n, run.id);
  });
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
      if (e.target.closest("#sb-stop")) {
        var stopTarget = currentMemberNode();
        if (stopTarget) stopNode(stopTarget);
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
    resumeInFlightPolls();
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
