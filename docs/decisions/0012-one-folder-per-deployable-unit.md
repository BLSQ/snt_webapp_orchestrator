# 0012. One self-contained folder per deployable unit

Date: 2026-10-19
Status: Accepted

## Context

The repo may later merge with `snt_development`, or both may move into a new "SNT stratification"
repo; the direction is undecided ([REPO-1](../BACKLOG.md#repo-1)). The old layout mixed concerns:
`app/<variant>/` plus a shared file assembled at deploy time, generator code under
`utils_pipelines/`, contracts and the external GraphQL schema together under `schemas/`.

`snt_development` splits one pipeline across `<name>/` at the root and `pipelines/<name>/` by deploy
route, which makes it hard to see or move one unit as a whole.

## Decision

- Each deployable unit is **one self-contained folder**: `webapps/<name>/` for a webapp bundle,
  `pipelines/<name>/` for a pipeline. The folder holds everything that unit deploys, and nothing
  else.
- Shared, non-deployed material has its own neutral top-level folder: `contracts/` (JSON contracts),
  `reference/` (external references), `docs/`, `design/`, `deprecated/`.
- Names stay neutral (no repo-specific prefixes), so a merge in either direction is a folder move.

## Consequences

- `webapps/orchestrator/` is deployed as it is; there is no assembly step.
- A unit can carry its own path-scoped `CLAUDE.md` (e.g. `webapps/orchestrator/CLAUDE.md`), loaded
  only when an agent works there.
- Repo paths and **runtime** paths are separate things. The generator's bucket key still starts
  `utils_pipelines/…` after the folder moved to `pipelines/`; that is deliberate
  ([REPO-3](../BACKLOG.md#repo-3)).
- If the repos converge, `snt_development`'s split layout is worth fixing the same way
  ([REPO-2](../BACKLOG.md#repo-2)).

Source: `ignore/PLAN.md` §1 *Deliberate improvements over `snt_development`'s layout*.
