# 0011. The repo is the reference source, not a deployment record

Date: 2026-10-19
Status: Accepted

## Context

`CLAUDE.md` and `README.md` used to record where things were deployed: webapp slugs and ids per
workspace and per variant, which workspaces had the generator, "verified live in <ws> on <date>"
notes. Those tables went stale between sessions, and agents acted on them. Webapp slugs are
editable, and OpenHEXA webapps are now git-backed with their own version history.

## Decision

- The repo is the **reference source for development and for the latest version** of the app and
  the generator. It does **not** record what is deployed where.
- Webapp identity and scopes (`id`, `slug`, URL, `allowedOperations`, `isPublic`) and which
  workspaces run the app are resolved **live** (`list_static_webapps`, `get_static_webapp`) when
  needed.
- Before editing an already-deployed webapp, read the live file(s) and diff them against the repo.

## Consequences

- No stale deployment tables; no repo commit after a deploy.
- A question like "which workspaces have the app?" costs an API call rather than a file read.
- What version a workspace runs is not knowable from the repo. Release versioning and a deployer
  are backlog items ([REL-1](../BACKLOG.md#rel-1), [REL-2](../BACKLOG.md#rel-2)).
- Leftover webapps (Flowchart variants, spikes) are no longer listed anywhere; cleaning them up is
  tracked in [OPS-1](../BACKLOG.md#ops-1) and [OPS-3](../BACKLOG.md#ops-3).

Source: `ignore/PLAN.md` §1 (goal 3 and decisions table).
