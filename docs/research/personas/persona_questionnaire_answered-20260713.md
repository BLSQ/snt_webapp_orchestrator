# SNT Pipelines Orchestrator — User Persona & Functional-Scope Questionnaire

**Status:** For PM review · 2026-06-14

**Companion to:** [`PRODUCT_SPEC.md`](../../PRODUCT_SPEC.md) (this sharpens §3 "Target user" and §5/§9 scope into decisions) and [`orchestrator_wireframe.html`](https://github.com/BLSQ/OpenHEXA-WebApp-Diary/blob/bbd02388f0104d809e55a81f5b84b29ce6b569bd/deprecated/flowchart/orchestrator_wireframe.html) (archived repo)

**Purpose (two audiences):**

1. 👔 **PM:** pin down a concrete user persona and confirm the functional scope boundaries. Every question is **Yes / No** on purpose — binary forces a decision instead of "it depends."
2. 🤖 **Future build agents:** once answered, this file is **reference context** for whoever (human or agent) builds the app — it records _who we are building for_ and _what is in/out of scope for v1_.

---

## **How to fill this in**

- **Tick exactly one box per question** (`[x]`). Use `Open` when you genuinely can't decide yet — that's a finding, not a failure.
- Each answer is on its **own line** so the checkbox renders in Obsidian, GitHub, and Google Docs.
- Lines marked **⭐** are the cruxes: if these flip, the product changes shape. They have a **Notes** line — please add a sentence of _why_.
- Leave the `(expected: …)` hints — they record the spec's current assumption so an agent can see where reality diverged from the draft.

**Legend:** Yes / No / Open — Open \= undecided / needs devs / needs research.

---

## **What we already established (discovery, 2026-06-11)**

Confirmed in conversation with the PM-side owner; treat as **given** unless a question below overrides it:

- **Primary user:** NMP staff (National Malaria Programme).
- **User↔workspace:** one country \= a **small team** sharing the workspace (not a single person).
- **Frequency:** bursty around the periodic SNT exercise **plus** ongoing monthly refreshes (DHIS2 has monthly periodicity).
- **Skill ceiling:** assume **Excel-level**; some users are DHIS2 power-analysts. Design for the floor.
- **Process literacy:** user **needs guidance throughout** — does not inherently know what to run or in what order.
- **Language:** **English only** for v1 and testing; **French required long term** (nearly all users are French-speaking, so French must eventually come first).
- **Connections:** **BLSQ holds the credentials** and creates connections during setup. (Comment from PM: “I think the goal of the orchestrator is that people can start using workspaces without involvement of BLSQ, so they should be able to set their own connections”)
- **`SNT_config.json`:** **hand-edited today**; a user-friendly config UI is a **long-term vision**, not built yet.
- **Install from template:** **one-click in the OpenHEXA UI** (no Git/CLI needed).
- **Still undecided (flagged ⭐ below):** user autonomy on failure; who owns setup; whether the app should detect/report setup gaps.

---

## **A. Identity & role**

1. Primary user is an **NMP employee** (vs. external consultant/partner). ⭐
   - [x] Yes
   - [ ] No
   - [ ] Open
   - **Notes:**
2. There is exactly **one designated person per country**. _(expected: No — a small team.)_
   - [ ] Yes
   - [x] No
   - [ ] Open
3. If a team: **all members** run pipelines (vs. one runs, others view).
   - [ ] Yes (all run)
   - [ ] No (one runs)
   - [x] Open
4. The user holds a **Monitoring & Evaluation (M\&E) / surveillance** role specifically — i.e. their job centres on tracking and reporting on health-program data.
   - [x] Yes
   - [ ] No
   - [ ] Open
5. Malaria-program **domain knowledge** (epi, stratification logic) is part of their job.
   - [x] Yes
   - [ ] No
   - [ ] Open
6. The **same person** stays across the whole annual cycle (no mid-cycle handoff).
   - [ ] Yes
   - [ ] No
   - [x] Open

## **B. Skills & tooling comfort ⭐**

7. **Excel** is the most advanced data tool we can assume they know (nothing more technical than spreadsheets).
   - [x] Yes
   - [ ] No
   - [ ] Open
8. They are **regular DHIS2-suite** users (analytics, pivot, maps).
   - [x] Yes
   - [ ] No
   - [ ] Open
9. We assume they can read/edit a **JSON config file** unaided. _(expected: No.)_
   - [ ] Yes
   - [ ] No
   - [x] Open
10. We assume they can read the **Pipeline Runs Messages/Logs** (OH UI) to understand a failure. _(expected: No.)_
    - [ ] Yes
    - [ ] No
    - [x] Open
11. They are comfortable with the concept of **parameters** — the settings/options a user chooses **before running** a pipeline that change how it behaves (e.g. which year of data to extract, which imputation method to use, a threshold value).
    - [ ] Yes
    - [x] No
    - [ ] Open
12. They understand what a **pipeline** is — an automated, multi-step data process that runs as one unit (takes input data → processes it → produces outputs), and that pipelines link into a chain where one pipeline's output feeds the next.
    - [x] Yes
    - [ ] No
    - [ ] Open
13. **English** is sufficient for **v1 and early testing** (real users trying it out and giving feedback). _(Long term the answer is **No**: French is required — nearly all our users are French-speaking, so eventually everything must be offered in French first.)_
    - [ ] Yes
    - [x] No
    - [ ] Open
14. Design for the **lowest** skill level (Excel-only), even if power-analysts get a simpler UI than they could handle. ⭐
    - [x] Yes
    - [ ] No
    - [ ] Open
    - **Notes:**

## **C. Process knowledge & mental model**

16. User already knows **which pipeline to run in what order**. _(expected: No.)_ ⭐
    - [ ] Yes
    - [x] No
    - [ ] Open
    - **Notes:**
17. User already understands **what each pipeline produces** (vs. relying on the app to surface it). _(Design implication — this is really a question about how much the app must explain: if **No**, the app has to make each pipeline's purpose/outputs discoverable, e.g. the one-line description on the card plus a link to the pipeline's GitHub README in the side panel (see Q67). Given the "needs guidance throughout" persona, this is likely **No** → the README/description display matters.)_
    - [ ] Yes
    - [x] No
    - [ ] Open
18. User understands the pipeline **type labels** without being told — **mandatory** (always required), **alternative** (one of a mutually-exclusive group — pick exactly one), and **facultative** (optional).
    - [ ] Yes
    - [x] No
    - [ ] Open
19. User can judge whether a run **succeeded meaningfully** — i.e. inspect the outputs/report, decide whether they're happy with their parameter choices, and decide whether to move on to the next pipeline or re-run this one with different parameters (not just see a green check).
    - [ ] Yes
    - [ ] No
    - [x] Open
20. App must **recommend the next step** (vs. only display the map and let them choose). ⭐
    - [ ] Yes (recommend)
    - [ ] No (display only)
    - [x] Open
    - **Notes:**

## **D. Autonomy & support ⭐ (biggest persona fork — currently undecided)**

22. User is expected to operate **without a BLSQ contact on call**. ⭐
    - [ ] Yes
    - [ ] No
    - [x] Open
    - **Notes: There is always training needed obviously**
23. When a **pipeline run fails**, it's acceptable that the user's only recourse is **"contact BLSQ."** ⭐ _Caveat: a more technical user could self-troubleshoot via the pipeline's detailed description and logic (incl. what each parameter means) in the `snt_development` GitHub repo — also mirrored on the OpenHEXA "Pipelines" run page._
    - [ ] Yes
    - [ ] No
    - [x] Open
    - **Notes:** we are going for automation and scheduling of pipelines, so in principle it should be set up and good for running. If it fails we might need someone from BLSQ depending on the challenges.
24. When a **pipeline run fails**, the app should **re-cast the pipeline's own run Messages** (which we already write to be human-readable in the main code) **inside the app**, rather than sending the user to the OpenHEXA UI to read them there (which assumes more technical comfort). _(Note: the app can't invent its own plain-language diagnosis — these existing Messages are the most human-readable signal available.)_
    - [ ] Yes
    - [ ] No
    - [ ] Open
25. A BLSQ technical person is **always reachable** during a country's exercise.
    - [ ] Yes
    - [ ] No
    - [x] Open
26. It's acceptable that the user **struggles to fix a misconfigured parameter on their own.** _(Nothing is technically broken — any parameter can be changed and the pipeline re-run. The real difficulty is **understanding what each parameter means** and how to choose or correctly enter a value.)_
    - [x] Yes
    - [ ] No
    - [ ] Open
27. User needs **in-app guidance/onboarding** (tooltips, "start here").
    - [x] Yes
    - [ ] No
    - [ ] Open

## **E. Setup & access ⭐ (setup owner currently undecided)**

27. **BLSQ** performs all technical setup (config, connections, install) before the user starts. ⭐
    - [ ] Yes
    - [ ] No
    - [x] Open
    - **Notes:**
28. If not BLSQ: a **separate, more technical country-side person** does setup.
    - [ ] Yes
    - [ ] No
    - [x] Open
29. It's acceptable that the running-user **never touches** workspace configuration.
    - [ ] Yes
    - [x] No
    - [ ] Open
30. The user already has an **OpenHEXA account** with "run" permissions ([**"Editor" role**](https://docs.openhexa.com/workspaces/#roles-and-permissions); granted by someone else).
    - [ ] Yes
    - [ ] No
    - [x] Open
31. The user should **install** (create from template) **missing pipelines** themselves. ⭐
    - [ ] Yes
    - [x] No
    - [ ] Open
    - **Notes:** _(see I.1 Q51 — note install is one-click)_  
      We (the devs) are working on template workspaces which will allow a user to create a typical SNT workspace populated with all relevant SNT pipelines.

## **F. Context & environment of use**

33. **Desktop/laptop only** (no tablet/phone).
    - [x] Yes
    - [ ] No
    - [ ] Open
34. User typically has an internet connection **reliable enough to open the app and trigger/check runs**. _(Limited relevance: pipelines run on OpenHEXA's servers, so the user does **not** need to stay connected while a run executes — they can close the app and check back later. "Reliable" here just means able to load the page and submit a run, not high-bandwidth or always-on.)_
    - [ ] Yes
    - [ ] No
    - [ ] Open

- **Notes**: we may have local deployments in country

34. Usage is **bursty around the periodic SNT exercise**. _(expected: Yes, plus monthly refresh.)_
    - [ ] Yes
    - [x] No
    - [ ] Open
35. The user returns **monthly** to refresh data (same person as the burst user).
    - [ ] Yes
    - [x] No
    - [ ] Open

- **Notes**: we want to automate and schedule.

36. User will often **leave and return mid-process** (needs "where did I get to").
    - [x] Yes
    - [ ] No
    - [ ] Open
37. The small team sharing the workspace works **closely / at overlapping hours**, so they can coordinate who runs what. _(Why it matters: they share one workspace and one set of runs — if they work independently/asynchronously, two people might run the same pipeline at once or overwrite each other's outputs, which affects whether the app needs to show "who is running what".)_
    - [x] Yes
    - [ ] No
    - [ ] Open

## **G. Goals, motivation & success**

38. Primary goal is to **produce the stratification data layers — with "ownership", not as a black box.** _(The point isn't just to spit out results: the core processing logic of each pipeline stays accessible (R code in `.ipynb` notebooks), and parameters expose the context-specific decisions the analyst should make — rather than a generic, pre-defined approach. Each pipeline produces output data **plus a report** with deeper insights, so the analyst can evaluate the results and decide whether to re-run with different parameter choices.)_
    - [x] Yes
    - [ ] No
    - [ ] Open
39. **"See at a glance what's done and what's left"** is the single most valuable thing the app gives. ⭐
    - [x] Yes
    - [ ] No
    - [ ] Open
    - **Notes:**
40. User **hands off** outputs to a downstream consumer (SNT Explorer / decision-makers).
    - [ ] Yes
    - [ ] No
    - [x] Open

- **Notes**: Could be, but most likely going back into NMDR.

39. The user is **accountable for the soundness of the outputs** — they own the parameter decisions and judge whether results are acceptable — rather than just mechanically running pipelines on someone else's instructions. _(Follows from the "ownership, not a black box" goal in Q38 and the "judge meaningful success" ability in Q18: the analyst is meant to make context-specific choices and stand behind the results. If **No** — they only execute and someone else validates — the app needs far less inline guidance/reporting for decision-making, which would reshape its purpose.)_
    - [ ] Yes
    - [ ] No
    - [x] Open

- Notes: So there should be many workshops for this, including validation workshops, before outputs can be returned to NMDRs.

40. App is a success if it only **orchestrates the existing, mapped pipelines** — it does **not** need to support custom/user-created pipelines outside the standard SNT map. _("No new analysis" \= no building of new pipelines or analyses inside the app; running and configuring the standard ones is enough.)_
    - [ ] Yes
    - [ ] No
    - [x] Open

- **Notes**:  
  PM: "_We still need to make additional pipelines._";  
  Giulia: "_Yes, and we (BLSQ DS team) will add them to the map of pipelines. But the question is whether new pipelines that the user makes (completely independently of BLSQ) are expected to appear in this pipeline orchestrator web app_";  
  PM: "_At this point I don't think that new users are meant to create new pipelines and add them to the app. Perhaps in a distance future that might be realistic but atm I feel that pipeline dev / openhexa dev is a bluesquare thing_"

## **H. Trust, risk & confidence**

43. User is likely **anxious about "breaking something"** by running a pipeline.
    - [ ] Yes
    - [x] No
    - [ ] Open
44. Runs have **cost/time consequences** the user should be warned about before running.
    - [ ] Yes
    - [x] No
    - [ ] Open
45. A re-run can **overwrite previous outputs** in a way the user must understand.
    - [x] Yes
    - [ ] No
    - [ ] Open
46. User needs **confirmation ("are you sure?")** before triggering a run.
    - [ ] Yes
    - [x] No
    - [ ] Open
47. User will **trust the app's status** over checking OpenHEXA directly, once learned.
    - [x] Yes
    - [ ] No
    - [ ] Open

---

# I. Functional scope — what stays in the OpenHEXA UI ⭐

Each confirms: **"Is it acceptable that the app does NOT do this, and the user goes to the OpenHEXA UI instead?"** These approve the boundaries `PRODUCT_SPEC.md` §5 only asserts.

## **I.1 Pipeline management**

48. App **cannot install** a pipeline (user installs with create from template in OH). Acceptable?
    - [x] Yes
    - [ ] No
    - [ ] Open
49. For a missing pipeline, the app should give a **direct link that takes the user straight to the OpenHEXA screen where the pipeline can be installed** (one click there), instead of just telling them to "ask BLSQ." ⭐
    - [x] Yes
    - [ ] No
    - [ ] Open
    - **Notes:**
50. App **cannot create / edit / delete / update** pipelines at all. Acceptable?
    - [x] Yes
    - [ ] No
    - [ ] Open
51. Installing a missing pipeline is **the user's task** (vs. always BLSQ's). ⭐
    - [ ] Yes (user's)
    - [ ] No (BLSQ's)
    - [x] Open
    - **Notes:** _(tension: "needs guidance throughout" persona vs. one-click install)_

## **I.2 Workspace configuration (`SNT_config.json`)**

53. App **does not** help build/edit `SNT_config.json` in v1 (still hand-edited). Acceptable?
    - [x] Yes
    - [ ] No
    - [ ] Open
54. Config is a **pre-condition**, assumed done before the user opens the app (not a step in it).
    - [x] Yes
    - [ ] No
    - [ ] Open
55. App should **detect config missing/invalid** and say so, even though it won't edit it. ⭐
    - [ ] Yes
    - [x] No
    - [ ] Open
    - **Notes:**
56. The future **config UI** is explicitly **out of scope for this app** (a separate future tool). ⭐
    - [x] Yes
    - [ ] No
    - [ ] Open
    - **Notes:** _(this is a v1 cut line, NOT a permanent boundary — long-term vision is to build it)_

## **I.3 Connections & credentials**

57. Since **BLSQ holds the credentials**, connections are **always created/edited by BLSQ during setup, before the user ever opens the app.** Acceptable?
    - [ ] Yes
    - [x] No
    - [ ] Open
58. App **never** touches connections (no create/edit/test); only _uses_ them by slug. Acceptable?
    - [x] Yes
    - [ ] No
    - [ ] Open
59. App should **warn** when a required connection is absent (a run would fail), though it can't create it. ⭐
    - [ ] Yes
    - [x] No
    - [ ] Open
    - **Notes:**
60. Safe assumption that the running-user **never sees or handles raw credentials**.
    - [ ] Yes
    - [x] No
    - [ ] Open

## **I.4 Setup-gap detection (cross-cutting ⭐ — currently undecided)**

61. On load, the app should **check whether the workspace is ready** ("connection X missing", "config not set", "pipeline not installed") and, if not, **send the user to the relevant OpenHEXA page to fix it.** ⭐ _("Link out" \= the app shows a message with a link that opens the right OpenHEXA screen in a new tab; the app doesn't fix it itself.)_
    - [ ] Yes
    - [x] No
    - [ ] Open
    - **Notes:**  
      PM: "_I am putting my bet on the template workspaces that should in principle in a few clicks make everything available, pipelines and apps so that user should not worry about anything_";  
      Giulia: "_Would a template ws also clone the connections and files like the SNT_config.json?_"
      PM: "_Files like metadata and config jsons should in prinicple be part of the template I feel, al beit with empty IDs for the config.json file. Connections will be hard because NMDR/SNIS have their own country-specific connections and credentials. I think that for anything related in setting up a workspace, we would need a dedicated page in the web app that enables users to do so. E.g. a guide that allows to set the connections, then the configuration file etc._"
62. If yes: it's enough for the app to **explain the problem in plain language and link the user to the OpenHEXA page to fix it** — the app itself never fixes anything (no in-app editing of config, connections, or pipelines).
    - [x] Yes
    - [ ] No
    - [ ] Open
63. Acceptable for v1 to **not check readiness at all** — if something isn't set up (a missing connection, missing config, or uninstalled pipeline), the user only finds out when they try to run a pipeline and it fails like any other error, with no special up-front warning.
    - [x] Yes
    - [ ] No
    - [ ] Open

---

# J. Functional scope — what the app _does_ (confirm the positives for v1)

`PRODUCT_SPEC.md` lists these; confirm each is in scope for the **first usable version**.

63. **Real last-run status per pipeline** on every load — v1 must-have.
    - [x] Yes
    - [ ] No
    - [ ] Open
64. **Launching a pipeline with parameters** from the app — v1 must-have.
    - [x] Yes
    - [ ] No
    - [ ] Open
65. Showing a run's **outputs** (HTML report \+ dataset links) — v1 must-have (vs. deferrable).
    - [x] Yes
    - [ ] No
    - [ ] Open
66. **Link to the live OpenHEXA run** (for logs) — v1 must-have.
    - [x] Yes
    - [ ] No
    - [ ] Open
67. **Link to each pipeline's GitHub README** — v1 must-have.
    - [x] Yes
    - [ ] No
    - [ ] Open
68. Drawing **dependency arrows** — required in v1 (even if nodes stay clickable).
    - [x] Yes
    - [ ] No
    - [ ] Open
69. **Dependency locking** (grey-out until upstream succeeds) — explicitly **deferred** past v1. _(spec open-Q2.)_
    - [ ] Yes (deferred)
    - [ ] No (needed in v1)
    - [x] Open
70. Showing **"missing" pipelines greyed-out** — v1 must-have. _(spec open-Q1.)_
    - [x] Yes
    - [ ] No
    - [ ] Open
71. Acceptable that the app shows status only for runs **launched in the current browser session** — i.e. if you close and reopen the app (or a teammate opens it), it shows nothing until a new run is triggered? ⭐ _Clarification: the alternative ("must persist") is that every time anyone opens the app it asks OpenHEXA for the **actual last run of each pipeline** and shows the true, up-to-date state — so you and your teammates always see what's been done, even after closing the app or days later. Given the small-team / leave-and-return / monthly-refresh usage, "must persist" is likely what's wanted; this question just confirms it._
    - [ ] Yes (session-only is OK)
    - [x] No (must persist across reloads and users)
    - [ ] Open
    - **Notes:**

---

## **The decisions that most reshape the product**

If these flip, rethink the design — push hardest on them:

- **Q21–22** — autonomy on failure (do we need plain-language error help \+ self-recovery?).
- **Q27 / Q51** — who owns setup, and does "one-click install" pull the user into setup?
- **Q7 / Q9 / Q14** — the true skill floor (Excel-only ⇒ no JSON, no logs).
- **Q15 / Q19** — must the app _guide_ (recommend next step) or merely _display_ the map?
- **Q60** — does the app proactively diagnose setup gaps, or stay silent until a run fails?

## **Note on the install-from-template contradiction**

Install-from-template being **one-click in OH** quietly contradicts the "BLSQ does all setup / user needs guidance throughout" persona. If install is genuinely one click, deep-linking the user there (Q49) may be reasonable even for a non-technical user — so **resolve Q51 deliberately**, don't let it default.
