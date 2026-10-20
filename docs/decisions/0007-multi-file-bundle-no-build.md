# 0007. A flat multi-file bundle: no build step, no CDN, no layout library

Date: not recorded
Status: Accepted

## Context

OpenHEXA static webapps serve `index.html` as the entry point and every other file (CSS, JS, JSON)
as-is from the same origin; only `text/html` responses get the platform's injection. Early
single-pipeline webapps were one HTML file; the orchestrator grew to ~100 KB of JS plus data.

Deploys happen through MCP tools, the OpenHEXA UI or raw GraphQL — none of which run a build. The
map has a fixed, hand-authored order, so automatic graph layout adds nothing.

## Decision

- The orchestrator is a **multi-file bundle of five flat files** in `webapps/orchestrator/`
  (`index.html`, `styles.css`, `app.js`, `pipeline_map.json`, `pipeline_descriptions.json`),
  referenced by relative paths and deployed exactly as they are in the repo.
- **No build step, no bundler, no npm dependencies, no CDN scripts, no graph-layout library.**
  Order and dependencies come from the map's explicit node order and `edges`.

## Consequences

- What is in the repo is byte-for-byte what is deployed; a deploy can be a partial upload of the
  changed files, and drag-and-drop in the OpenHEXA UI works.
- Data (map, descriptions) can be edited without touching code.
- No third-party code runs in the app. Adding any script tag (e.g. OpenHEXA's own `dev.js`,
  [DEV-1](../BACKLOG.md#dev-1)) is a reviewed change.
- No type checking, minification or module system: `app.js` is one large plain-JS file, and
  structure is by convention ([`webapps/orchestrator/CLAUDE.md`](../../webapps/orchestrator/CLAUDE.md)).

Sources: former `CLAUDE.md` *Multi-file app architecture* and *Map format*.
