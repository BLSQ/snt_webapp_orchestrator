# 0005. The catalog is not stored in `workspace.configuration`

Date: not recorded (noted around 2026-08, after [0002](0002-catalog-in-workspace-bucket.md))
Status: Accepted

## Context

`Workspace.configuration: JSON!` is a workspace-wide JSON dictionary. A pipeline can write it (SDK
`workspace.configuration = config`, or the `updateWorkspace` mutation), and a webapp can read it
with no extra scope (`USER_READ` grants `workspace`). That made it an apparent alternative to the
bucket file chosen in [0002](0002-catalog-in-workspace-bucket.md).

## Decision

Keep the catalog in the workspace bucket. Do not migrate it to `workspace.configuration`.

## Consequences

- The bucket path keeps a timestamped history of every catalog under `historical/`;
  `configuration` would be a single blob with no history.
- The catalog is 35–60 KB. The bucket handles that without question; `configuration` has no
  documented size guarantee, and it is shared with anything else a workspace stores there.
- The app keeps needing `FILES_READ` to boot.
- Revisit only with a concrete reason (e.g. signed-URL problems), and as a new ADR.

Source: former `CLAUDE.md` *Alternative not taken: `workspace.configuration`*.
