# 0013. A fresh public repo from one snapshot; history and `deprecated/` stay in the archived repo

Date: 2026-10-20
Status: Accepted

## Context

The orchestrator was developed in `BLSQ/OpenHEXA-WebApp-Diary`, a working diary: spikes, two UI
variants, deployment tables, workarounds for older OpenHEXA and MCP behaviour. The October 2026
cleanup (phases 0–3) left a cockpit-only tree whose docs state current truth, but the git history
and the `deprecated/` folder still carried the old material. The repo was also to become public.

## Decision

- The cleaned tree of `OpenHEXA-WebApp-Diary` `main` at commit
  [`bbd0238`](https://github.com/BLSQ/OpenHEXA-WebApp-Diary/tree/bbd02388f0104d809e55a81f5b84b29ce6b569bd)
  plus the cut-over edits was copied into a new **public** repo, `BLSQ/snt_webapp_orchestrator`, as
  a single initial commit. The old repo is archived (read-only), with a pointer to the new one.
- `deprecated/` (the parked Flowchart UI, its spec and revival steps, the retired spikes) is **not**
  carried over. It stays readable at
  [`deprecated/` in commit `bbd0238`](https://github.com/BLSQ/OpenHEXA-WebApp-Diary/tree/bbd02388f0104d809e55a81f5b84b29ce6b569bd/deprecated)
  of the archived repo.

## Consequences

- No git history before the snapshot here. `git log` / `git blame` for older work runs against the
  archived repo ([DOC-2](../BACKLOG.md#doc-2)).
- Nothing still in use is lost: the decisions are in ADRs (e.g. 0002, 0009), and what the spikes
  proved (report iframe on a signed URL, last-run status through the proxy) is in
  [`OPENHEXA_WEBAPP_RUNTIME.md`](../OPENHEXA_WEBAPP_RUNTIME.md). Only the parked code, the
  Flowchart spec and the spike write-ups live in the archived repo.
- Mentions of `deprecated/` in earlier ADRs (0009, 0012) refer to that archived copy.
- Links into the archived repo are pinned to commit `bbd0238`, so they do not break if its `main`
  gets the pointer commit.
- Public repo: nothing workspace-secret may be committed (the repo already holds no tokens; webapp
  calls are authenticated by session cookie).

Source: `ignore/PLAN.md` Phase 4; Giulia's cut-over decisions of 2026-10-20 (name, public, drop
`deprecated/`).
