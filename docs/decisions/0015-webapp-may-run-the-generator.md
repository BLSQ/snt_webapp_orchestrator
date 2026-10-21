# 0015. The webapp may run the catalogue generator

Date: 2026-10-21
Status: Accepted

## Context

A newly installed pipeline stays "not installed" in the app until `create_pipeline_cards` has
rewritten the workspace's catalogue ([ADR 0002](0002-catalog-in-workspace-bucket.md),
[ADR 0003](0003-catalog-parameters-from-deployed-version.md)). Users had to leave the app, find the
generator in OpenHEXA, run it, wait, and come back. The webapp already holds `PIPELINES_RUN` (R9),
and the generator takes no parameters.

## Decision

- The **not-installed panel** (step 2) offers a **Refresh the catalogue** button that starts
  `create_pipeline_cards` with an empty config, then shows its progress. Anyone who can open the
  app sees it; OpenHEXA's own permissions decide whether the run is accepted.
- What step 2 offers follows the generator's live state: not installed → a link to its template; a
  run in flight → "Refresh in progress…", watched like the app's own; lookup failed → the pipelines
  list. The state is looked up on each render and never cached.
- After a successful run the app offers a **Reload page** button. It does not reload by itself and
  does not reload the catalogue in place (switching to auto-reload is the one constant
  `GEN_REFRESH_AUTO_RELOAD` in `app.js`).
- The webapp **cannot install** pipelines (no scope for it; R9 is unchanged), so step 1 stays a
  link to the templates.

## Consequences

- Safe: the generator only rewrites the catalogue file, from what is deployed in the workspace. The
  catalogue stays the generator's output (R3); the app never writes it.
- One more workspace-wide side effect is one click away. A double click starts one run only.
- The run-error drift hint and the boot "no catalogue" panel still only link to the generator
  ([APP-6](../BACKLOG.md#app-6), [APP-7](../BACKLOG.md#app-7)).
