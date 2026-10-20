# 0006. The node `id` (Python function name) is the only cross-workspace key

Date: not recorded
Status: Accepted

## Context

The same SNT pipeline gets a different UUID in every workspace, and its code/slug and display name
also differ depending on how it was installed (template install vs CLI push). The map, the
descriptions and the catalog must still be joined on something, and the bundle must be identical
in every workspace.

## Decision

- The join key everywhere is the pipeline's **Python function name** — the first argument of
  `@pipeline("…")`, which is also its folder name in `snt_development` (e.g. `snt_dhis2_extract`).
- It is the node `id` in `pipeline_map.json`, the key in `pipeline_descriptions.json`, and the `id`
  of each card in `pipeline_cards.json`.
- UUIDs and codes are used only at runtime, read from that workspace's own catalog. They never
  appear in the repo and never cross workspaces.

## Consequences

- One bundle serves every workspace; matching is by `id`, never by name or code.
- `ohName` in the map mirrors the OpenHEXA display name so users can find the pipeline there. It is
  display-only.
- The generator must extract the id from the deployed `pipeline.py` source by regex. A pipeline
  with no deployed `pipeline.py` (e.g. notebook-based) or a malformed decorator gets `id: null` and
  is excluded.
- Never copy a catalog between workspaces: its UUIDs would be wrong.

Sources: former `CLAUDE.md` *Pipeline IDs are workspace-specific* and *Data architecture*.
