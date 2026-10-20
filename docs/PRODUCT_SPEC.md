# SNT Pipelines Orchestrator — Product Specification

> **Purpose:** one shared definition of _what the product is_, _what it does today_, and _what each
> version (v0 / v1 / v2) adds_ — to pin down version scope with the PM and check technical
> feasibility with the OpenHEXA developers.
>
> **v1 is in progress.** Items carry a build marker. Built v1 items stay **v1 scope** — they are
> not back-dated into v0, which is the frozen 2026-07-14 baseline:
>
> - **✅ Built** — implemented in the app.
> - **🔨 In progress** — partially done.
> - _(unmarked)_ — still to do.
>
> **How this document is organised:**
>
> - **Part A — Functionality** (§4–§6): what the app _does_.
> - **Part B — UI** (§7–§8): how the guided walkthrough presents it.
> - **Part C — Versioning** (§9–§10): the v0 / v1 / v2 roadmap and the open decisions the PM owns,
>   each with a recommended version.
>
> **How to review:** the PM owns Parts A and C and the UI direction in Part B. The developers own
> the technical-basis column of §6.
>
> **Related:** how it is built — [`ARCHITECTURE.md`](ARCHITECTURE.md); why — [`decisions/`](decisions/README.md);
> repo-level open items — [`BACKLOG.md`](BACKLOG.md); SNT vocabulary — `snt_development`'s
> [`docs/GLOSSARY.md`](https://github.com/BLSQ/snt_development/blob/main/docs/GLOSSARY.md); user
> research — [`research/personas/persona_questionnaire_answered-20260713.md`](research/personas/persona_questionnaire_answered-20260713.md);
> UX target — [`design/wireframes/orchestrator_wireframe_cockpit.html`](../design/wireframes/orchestrator_wireframe_cockpit.html).
> The parked Flowchart (2D map) UI has its own spec in
> [`deprecated/flowchart/SPEC.md`](https://github.com/BLSQ/OpenHEXA-WebApp-Diary/blob/bbd02388f0104d809e55a81f5b84b29ce6b569bd/deprecated/flowchart/SPEC.md)
> in the archived predecessor repo.

---

## 1. In one sentence

A single, no-code web interface — deployed inside an OpenHEXA workspace — that shows the
**entire SNT stratification process as a guided flow** and lets a small, non-technical team **see
the status of, configure, and run every pipeline** from one place.

## 2. Context & goal

- The **SNT stratification process** imports, processes, cleans and transforms country data to
  produce the data layers needed for the next step — intervention mix and budgeting. Those layers
  most often feed the **SNT Explorer (IASO)**, and may also flow **back into the country's NMDR**
  (national malaria data repository). This app covers only the stratification part.
- The process is broken into steps; **each step is an OpenHEXA pipeline**. The standard SNT
  pipelines exist and work in OpenHEXA and can be installed into any workspace from **templates**
  (they work out of the box once the required input data is present). **More pipelines are being
  added** — the map is expected to grow.
- In an OpenHEXA workspace these pipelines appear in the **Pipelines** section **in order of
  creation** — not in logical order, and with no indication of which are mandatory, optional, or
  alternatives. This is hard for users to navigate.
- **The app solves this** by re-casting that view as a clear, fixed **process flow**, so a user can
  understand the whole process at a glance and execute it from one screen.
- **Direction of travel:** the team is moving toward **scheduling and automating** pipeline runs.
  So the app is less a "run everything by hand every month" tool and more a **monitoring +
  on-demand-run + configuration surface** over a process that is increasingly scheduled. The
  single most valuable thing it gives remains **"see at a glance what's done and what's left."**

## 3. Target user

The persona below is the agreed design target. **Design for the floor, not the ceiling.**

- **Who:** staff of a country's **National Malaria Programme (NMP)** — an employee, not an
  external consultant. Their role centres on **Monitoring & Evaluation / surveillance**, and
  **malaria-program domain knowledge** (epidemiology, stratification logic) is part of the job.
- **A team, not a person:** one country = a **small team** sharing one workspace and one set of
  runs. They work **closely / at overlapping hours** and can coordinate who runs what. _(Whether
  every member runs pipelines or one runs while others view is still open — see §10.)_
- **Skill floor — Excel:** the most advanced data tool we may assume is **Excel/spreadsheets**.
  Some users are DHIS2 power-analysts, but the UI is designed for the Excel-level floor even if
  that under-serves the power users.
- **Codes? No.** The platform is explicitly **no-code**. Technical users who want hands-on control
  are redirected to native OpenHEXA (Pipelines, JupyterHub, Datasets) and the `snt_development`
  GitHub repo — the app does not try to replace those.
- **Mental model — partial.** The user understands **what a pipeline is** (input → process →
  output, chained). But they **do not** reliably know **which pipeline to run in what order**,
  **what each pipeline produces**, or the meaning of the **type labels** unaided. → **The app must
  make all of this discoverable in-context** (descriptions, README links, a legend, guidance).
- **Parameters — not a comfortable concept.** Users are **not** inherently comfortable with the
  idea of parameters (settings chosen before a run that change its behaviour). Yet parameters are
  central to the product's value: they expose the context-specific decisions the analyst is meant
  to own. → **The parameter form must be as approachable as possible** — clear labels, help text,
  sensible defaults — and it is **accepted** that a user may still struggle to choose a value
  (nothing breaks; any parameter can be changed and the pipeline re-run).
- **Ownership, not a black box.** The user is meant to **own the parameter decisions and judge
  whether the results are acceptable** — inspecting each run's report, deciding whether to move on
  or re-run — rather than mechanically executing someone else's script. Accountability for the
  _soundness_ of outputs is expected to be reinforced by **validation workshops** before layers
  return to the NMDR. _(Formal accountability model still open — see §10.)_
- **Guidance throughout.** The user **needs in-app guidance/onboarding** (tooltips, a "start here",
  a legend, a walkthrough of the process). The app should teach the process, not assume it.
- **Leave and return.** The user will often **leave and return mid-process** and needs to see
  "where did I get to" — which makes **persistent, real status** (not session-only) essential (§6).
- **Language:** **French is the main interface language for v1** — nearly all users are
  French-speaking. **✅ Built:** one app with an **EN/FR toggle** in the header, remembered per user,
  with `?lang=fr` deep-linking ([ADR 0008](decisions/0008-one-bilingual-app.md)). ⚠️ The **French
  copy is a draft, pending review** — the mechanism is done, the wording is not signed off.

### 3.1 Autonomy & support (largely still open — see §10)

- The intent is that a country can **increasingly self-serve** (the goal of scheduling/automation
  is that a workspace, once set up, "just runs"). **Training is always assumed.**
- On **failure**, the recourse is "check the run in OpenHEXA / contact BLSQ." Because we are moving
  toward set-and-schedule, a healthy workspace should rarely fail; when it does, a BLSQ technical
  person may be needed depending on the problem. Surfacing the pipeline's own run messages inside
  the app is a versioned open point (§10, recommended v2).

---

# Part A — Functionality

## 4. What the app does

- Presents **all standard SNT stratification pipelines** as a **process flow**, walked through one
  step at a time, with each step's dependencies listed (Requires / Unlocks / Uses if available).
- Shows, at a glance and **on every load**, the **real last-run status of each pipeline** — never
  run, succeeded, failed, running, etc. — queried live from OpenHEXA so it **persists across
  reloads and across teammates** (not just the current browser session).
- Marks pipelines that are part of the standard process but **not installed in this workspace** as
  **greyed-out** and opens a lightweight "how to install" panel for them (deep link to the
  OpenHEXA templates page).
- Lets the user **open a pipeline's details** and **launch it with parameters** without leaving the
  app; then **polls the run to completion** and updates the status live.
- After a run, shows that run's **outputs** — output **datasets** and **files** (including the
  **HTML report**) — as direct links, with the report also rendered in-app.
- Enforces **mutual exclusion within alternative groups**: where the process offers a choice of
  method (e.g. outlier-imputation methods, reporting-rate variants), the app shows which one is
  currently **in use** (the member holding the most recent successful run) and marks the others
  **superseded**.
- Enforces **dependency hard-locking**: a pipeline stays **locked** (its Run button disabled) until
  every **hard** upstream prerequisite has a completed run; it unlocks live as prerequisites
  succeed. Locking is **group-aware** (any one member of an alternative group satisfies the
  prerequisite) and **optional links are non-gating** (listed, but they do not lock).
- **Links out to the deeper OpenHEXA views** (the live run with logs, the output datasets, the
  pipeline's README on GitHub, the templates page to install a missing pipeline) for anyone who
  wants more detail or needs to act outside the app's scope.

### 4.1 The pipeline map (the process model)

- The map is a **process flow**: pipelines flow in execution order, with parallel **tracks** where
  steps are independent (**A — DHIS2**, **B — WorldPop & MAP**, **C — DHS**, **D — ERA5**).
- The map is **fixed and standard** — it reflects the SNT process itself, which is the same for
  every workspace and country. **It does not change per workspace.** What differs per workspace is
  only _which_ pipelines are installed (installed → active; not installed → greyed).
- The map is **authored separately** (by the SNT team, validated with the PM) as a standalone file
  (`webapps/orchestrator/pipeline_map.json`) — _not_ hard-coded into the page. It captures, per
  node: **type** (mandatory / alternative / facultative), the **group** that ties
  mutually-exclusive alternatives together, its walkthrough stage and track, and the directed
  **dependency edges** between pipelines (hard dependency vs optional link). Technical detail:
  [`ARCHITECTURE.md`](ARCHITECTURE.md#map-format).
- **Pipeline types** are **mandatory**, **alternative** (one of a mutually-exclusive group — pick
  exactly one), and **facultative** (optional). Because users **don't** know these labels unaided
  (§3), the app must make them legible (legend + in-panel cues). The map is expected to **grow** as
  new pipelines are added.

## 5. What the app does NOT do

These stay in the native OpenHEXA UI, by design. The persona answers **confirmed** these
boundaries.

- **Manage pipelines** — install / create / update / delete. The app **cannot** install a
  pipeline; for a **missing** one it provides a **direct link to the OpenHEXA templates page**
  where it can be installed (one click there), instead of only saying "ask BLSQ."
  _(Longer term, dev-side "template workspaces" will create a workspace pre-populated with all
  relevant SNT pipelines, largely removing per-pipeline install from the user's path.)_
- **Workspace configuration** — the `SNT_config.json` is a **pre-condition**, hand-edited in
  OpenHEXA before the user opens the app. The app **does not** build, edit, or **validate** it.
  A friendly config UI is a **separate future tool**, explicitly out of scope here.
- **Manage connections** — the app **never** creates/edits/tests connections; it only _uses_ them
  by slug. _(Who owns connections is shifting — see §10. The PM's steer is that users should
  eventually set their own connections, so "BLSQ always creates every connection first" is not
  assumed as a permanent truth.)_
- **Proactively diagnose setup gaps.** It is **acceptable not to check readiness up front**: if a
  connection, config, or pipeline is missing, the user finds out when a run fails like any other
  error. _(If we ever add readiness checks, the app would only explain the problem in plain
  language and link out to the right OpenHEXA page — it would never fix anything itself. See §10.)_

## 6. Functionality catalogue & technical feasibility

The stable set of capabilities, each with the technical basis that makes it possible on an
OpenHEXA static webapp (HTML/CSS/JS served inside a workspace, calling the GraphQL API through a
same-origin proxy). **All of these are built and were part of v0** (§9); they are the baseline the
roadmap builds on. Technical detail: [`OPENHEXA_WEBAPP_RUNTIME.md`](OPENHEXA_WEBAPP_RUNTIME.md).

| ID  | Capability | What it means for the user | Technical basis | Status |
| --- | --- | --- | --- | --- |
| F1  | **Live, persistent status board** | On every load, each pipeline shows its real last-run status; true for the whole team, across reloads and days. | `pipelines(workspaceSlug:)` → `runs(orderBy: EXECUTION_DATE_DESC, perPage:1)`, under `PIPELINES_READ`. | ✅ |
| F2  | **Missing-pipeline detection** | Pipelines not installed here are greyed; a panel explains they're standard and deep-links to the templates page. Once installed, the step goes live as soon as the catalog is regenerated — no redeploy. | A step is available iff its `id` is in the workspace's catalog (with a `uuid`); otherwise greyed. | ✅ |
| F3  | **Pipeline detail panel** | Name/code/type, a description of what the pipeline does, and a link to its GitHub README. | Static content from the map, descriptions and catalog + `github.com/BLSQ/snt_development/tree/main/<pipeline_id>`. | ✅ |
| F4  | **Parameter form + config preview** | A typed input per parameter (checkbox, number, dropdown, multi-select, **connection dropdown**), help text, sensible defaults; a "preview config" toggle shows the exact package to be sent. | Form generated from the catalog; connection dropdown from `workspace { connections }` (`USER_READ`, else a text fallback). | ✅ |
| F5  | **Run + poll** | A Run button launches the pipeline and polls it to completion, live-updating the step. | `runPipeline` mutation, params as a `config` object (connections passed by **slug**). Needs `PIPELINES_RUN`. | ✅ |
| F6  | **Outputs & report links** | After a run, links to its output **datasets** and **files**; the **HTML report** opens via a signed URL. | `pipelineRun.outputs` (union) + `prepareObjectDownload` signed URL. Needs `FILES_READ`. | ✅ |
| F7  | **Mutual exclusion (alt. groups)** | For a choose-one method group, shows which member is **in use** (holds the latest success) and marks the others superseded. | Derived client-side from run history + the map's `group`. Only a _succeeding_ run moves the "in use" mark. | ✅ |
| F8  | **Dependency lists** | Each step lists what it **requires**, what it **unlocks next**, and what it **uses if available**; hard and optional links are told apart. | Derived client-side from the map's `edges`. No layout library / CDN. | ✅ |
| F9  | **Dependency hard-locking** | A step is locked (Run disabled) until every hard prerequisite has completed; unlocks live. Group-aware; optional links don't gate. | Computed client-side from map edges + the F1 status board. | ✅ |
| F10 | **Deep links out to OpenHEXA** | Jump to the live run (logs/messages), output datasets, the GitHub README, or the templates page. | Links to `app.openhexa.org` pages built client-side. | ✅ |

**The per-workspace catalog.** The list of installed pipelines and their parameters (which drives
F2 and F4) is generated in each workspace by a companion pipeline, `create_pipeline_cards`, and
read by the app at page load ([ADR 0002](decisions/0002-catalog-in-workspace-bucket.md)). At product
level this means:

- **Configuration changes need no deploy.** Installing a pipeline, or a parameter changing in a
  newer version, is picked up by re-running the generator and refreshing the page.
- **The parameter form matches the version actually installed** in the workspace
  ([ADR 0003](decisions/0003-catalog-parameters-from-deployed-version.md)). This is a _different_
  problem from the README drift in §8, which is about documentation and is still open.
- **A workspace must have the generator run once before the app works** — otherwise the app
  explains what is missing and links to the fix.

---

# Part B — UI

## 7. The guided walkthrough

The app is a **guided, one-step-at-a-time walkthrough** (the "Cockpit" UX, the PM's preferred
design). Its structure is what teaches the process. A 2D map variant ("Flowchart") was built as a
side product and is parked ([ADR 0009](decisions/0009-cockpit-only-flowchart-parked.md)).

- **One-step-at-a-time focus.** Instead of a whole-canvas map, the app foregrounds the **current /
  next relevant step** and walks the user forward through the process, using the dependency model
  (F8/F9) to decide what comes next.
- **Per-pipeline descriptions** (the v1 content investment): each step's one-liner is expanded to a
  **short paragraph** — what the pipeline is, what it produces, and how to read its result — aimed
  at the Excel-level floor and the "partial mental model" persona (§3). The PM drafts the text for a
  couple of pipelines as a template; Giulia completes the rest. **🔨 In progress — 2 of 18
  expanded** (`snt_dhis2_extract` A.1, `snt_dhis2_formatting` A.2); the rest are one-liners. The
  delivery mechanism is done (`webapps/orchestrator/pipeline_descriptions.json`, bilingual), so
  completing this is **content authoring, not development**.
- **Full narrative layer — parked.** Extra per-step text walking the user through the whole
  process was considered for v1 but deliberately parked (PM, 2026-07-15): authoring all that
  guidance is too big to take on now. It is reconsidered as a possible v2. Reference UX (_not_ v1):
  `design/wireframes/orchestrator_wireframe_cockpit_narrative.html`.
- Renders the full functionality set (F1–F10): status per step, parameter form + preview, run +
  poll, outputs/report, mutual-exclusion notices, and lock/unlock state.
- **Desktop only** (landscape). Not designed for mobile/tablet.

## 8. UI rules

- **Status vocabulary.** The app mirrors OpenHEXA's own run statuses — `queued`, `running`,
  `success`, `failed`, `stopped`, `skipped`, `terminating` — plus two app-level states: **Never
  run** (installed, no runs; neutral) and **Missing** (standard but not installed; greyed, §5/F2).
- **Trust, risk & confidence.** **No "are you sure?" confirmation** before a run and **no cost/time
  warning** — users are not assumed to be anxious about "breaking something," and there are no
  per-run cost consequences to guard against. A **re-run can overwrite previous outputs**, and the
  app should make that consequence legible in its copy, without gating runs behind a modal.
- **Dependencies section — condensed (v1). ✅ Built.** The Dependencies block (the F8/F9 "Requires /
  Unlocks next / Uses if available" lists) took too much vertical space — worst case **A.2 · DHIS2
  Formatting**, which unlocks 10+ pipelines. Each labelled section (**Dependencies**, _Choose a
  method_, _Parameters_, _Latest outputs_) is a **collapsible box** with a keyboard-accessible
  header toggle; **Dependencies starts collapsed** (it's the tallest), the others start open. The
  description block is **not** collapsible — it stays visible. ⚠️ **Not built:** per-type counts in
  the collapsed header (§10 item 9).
- **Embedded HTML report (v1). ✅ Built.** Rather than only link out to the run's HTML report (F6),
  its **content renders in a box at the bottom of the step**, so the user reads the result without
  leaving the app (an `<iframe>` on a freshly signed URL, re-signed on demand).
- **Documentation source — README drift (planned v1).** The detail panel links to each pipeline's
  **README on GitHub `main`** (F3), which reflects the _latest_ pipeline version and may not match
  the (possibly older) version **installed** in the workspace. See §10 item 8.

---

# Part C — Versioning

## 9. Roadmap (v0 / v1 / v2)

**How to read this.** All of the **functionality catalogue (F1–F10, §6) was present at v0**; the
table tracks only the **deltas** each version adds. Definitions:

- **v0 — the frozen baseline (2026-07-14).** What was built when this roadmap was drawn. ⚠️ **v0
  is a historical snapshot, not "whatever is built today."** Work completed since then belongs to
  **v1** and stays in the v1 column with a build marker.
- **v1 — first version exposed to real users, and the version in progress.** The bar for putting
  the app in front of an actual NMP team.
- **v2 — longer-term view.** Bigger enhancements, several shaped by feedback from v1 users and by
  the platform's move toward scheduling/automation.

Items in _italics_ are open decisions (§10) placed at their **recommended** version.

| Aspect | v0 — baseline | v1 — first real users (adds…) | v2 — longer term (adds…) |
| --- | --- | --- | --- |
| **Functionality (F1–F10)** | ✅ Full set built (§6) | — (baseline carries forward) | — |
| **Deployment scope** | Development and test workspaces only | A **real country workspace** for a pilot NMP team | Further country workspaces |
| **Per-pipeline descriptions** | Placeholder / partial one-liners | **Short paragraph per pipeline** (what it is / produces / how to read it); PM seeds a couple, Giulia completes the rest — 🔨 **2 of 18 done** (A.1, A.2) | Richer per-step "how to read this" content |
| **Guidance / narrative** | Guided one-step-at-a-time structure; minimal copy | — (**full narrative layer parked**, §7) | _Full narrative layer_ — per-step plain-language walkthrough; onboarding "start here" tour |
| **Documentation source** | README link to GitHub `main` (F3) | **Resolve GitHub-README vs installed-version drift**; explore surfacing the template's **"Template Documentation"** in-app | — |
| **Dependencies display** | Full Requires/Unlocks/Uses lists | ✅ **Built** — sections collapsible; Dependencies starts collapsed. _Per-type counts not built_ (§10 item 9) | — |
| **Report viewing** | HTML report via signed-URL link-out (F6) | ✅ **Built** — report embedded at the bottom of the step | — |
| **Localization** | English only | ✅ **Built** — single-app **EN/FR toggle** (persisted, `?lang=` deep link). ⚠️ French copy is **draft, pending review** | French-first; more languages as needed |
| **Failure help** | Link out to the OpenHEXA run on failure (F10) | — | _Plain-language failure summary in-app + run messages / log excerpts_ |
| **Guidance intelligence** | Static dependency model drives order (F8/F9) | Static, pre-authored order only | _Active "recommend the next step to run"_ |
| **Team & scheduling** | Single shared status board (F1) | — | _"Who is running what" visibility_; surface **scheduled/automated** runs |
| **Setup self-service** | Uses connections by slug only (F5); BLSQ sets up config/connections | — | _User-set connections_ / readiness checks, pending platform + ownership decisions |

## 10. Open decisions for the PM (with recommended version placement)

Each open point is tagged with the version where it is **recommended** to land, so the PM can
confirm or move it. Item numbers are stable references; resolved items keep their number.

1. **French localization — _v1 (decided; ✅ built)._** French is the main interface language for
   v1; one app with a language toggle ([ADR 0008](decisions/0008-one-bilingual-app.md)).
   **Remaining for v1:** (a) **review/sign off the French copy** — currently draft
   ([UI-5](BACKLOG.md#ui-5)); (b) decide whether **parameter labels/help** (which come from the
   pipeline source, not the app) should also be translated — today they stay English
   ([UI-4](BACKLOG.md#ui-4)).
2. **In-app failure help — _v2._** On a failed run, surface a **plain-language summary in-app** and
   (deeper) **run messages / log excerpts**. v1 keeps the link-out to the OpenHEXA run (F10).
   _(Q24; PM re-prioritised from v1.)_
3. **Per-pipeline descriptions — _v1._** Each pipeline's one-liner is expanded to a **short
   paragraph** (what it is / produces / how to read its result). **Authoring model:** the PM drafts
   the text for **a couple of pipelines** as a template, then **Giulia completes the rest**. This
   replaces the parked full-narrative layer. 🔨 2 of 18 done.
4. **Recommend the next step — _recommended v2._** Today the app is a **map you read**: it shows
   each pipeline's status, locks steps until their prerequisites succeed, and walks you through a
   fixed, pre-authored order — but _you_ still decide what to run next. An **active recommendation
   engine** (v2) would point at one specific action, computed from the workspace's live state,
   including harder calls like "A.1 changed, so A.2 is now stale — re-run it." Most likely an inline
   **"next step" banner** pinned at the top (e.g. _"Next: run A.2 · DHIS2 Formatting"_ with a Run
   button) or a highlighted **"▶ Recommended next"** call-to-action on the step; a persistent strip,
   **not** a pop-up/modal. A lighter-touch variant is a **"▶ next" badge** on the recommended step.
   It's placed at v2 because it shifts the product from _showing_ the process to _driving_ it — a
   product-shape decision that can feel paternalistic to a domain expert meant to own the choices,
   and is best calibrated with real v1 feedback. _(Q20.)_
5. **Team run model & visibility — _recommended v2._** Do **all** members run pipelines, or one
   runs while others view? Should the app show **"who is running what"** (they share one workspace
   and one set of runs)? Note the real DRC-workshop confusion when two users installed the same
   template pipeline. _(Q3/Q37.)_
6. **Connections & setup ownership — _recommended v2._** The steer is that users should eventually
   **set their own connections** (contradicting "BLSQ always sets them up first"). Confirm the
   target model, whether the running user ever handles raw credentials, and whether "one-click
   install" legitimately pulls a non-technical user into setup. Depends on platform support.
   _(Q27/Q28/Q51/Q57/Q60.)_
7. **Which UI ships — _resolved._** The guided walkthrough (Cockpit) is the one UI; the 2D map
   (Flowchart) is parked ([ADR 0009](decisions/0009-cockpit-only-flowchart-parked.md)). Whether a 2D
   map ever becomes user-facing is recorded with the parked code in
   [`deprecated/flowchart/README.md`](https://github.com/BLSQ/OpenHEXA-WebApp-Diary/blob/bbd02388f0104d809e55a81f5b84b29ce6b569bd/deprecated/flowchart/README.md)
   in the archived predecessor repo.
8. **Documentation source — README drift vs "Template Documentation" — _v1._** The detail panel
   links to each pipeline's README on GitHub `main`, which may not match the version **installed**
   in the workspace. A candidate route: pipelines installed from a template carry a **"Template
   Documentation"** field (equivalent to the README) that could be **shown in-app** (e.g. a popup)
   instead of linking out. **Question for the team (Giulia to ask):** how is the template
   pipeline's "Template Documentation" field linked to GitHub? ([UI-6](BACKLOG.md#ui-6))
9. **Condense the Dependencies section — _v1 (✅ built; one sub-question left)._** Every panel
   section is a collapsible box and Dependencies **starts collapsed** (§8). **Still open:** are the
   **per-type counts** in the collapsed header (_"Requires (2 pipelines)"_ / _"Unlocks (11
   pipelines)"_) still wanted? Not built. ([UI-7](BACKLOG.md#ui-7))
10. **Embed the HTML report in-app — _v1 (✅ built; resolved)._** The run's HTML report renders in a
    box at the bottom of the step (§8).

Resolved earlier (kept for traceability): missing-pipeline UX → greyed + clickable "how to
install" panel with a templates deep link (Q49/Q70); persistent vs session-only status → must
persist across reloads and teammates (Q71); desktop-only, no mobile/tablet (Q33); outputs display
→ built (HTML report + dataset/file links, Q65); up-front readiness checks → not required,
fail-on-run is acceptable (Q63); dependency hard-locking → built.
