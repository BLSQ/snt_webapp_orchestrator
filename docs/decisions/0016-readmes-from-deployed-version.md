# 0016. Pipeline READMEs come from the deployed version, copied by the generator

Date: 2026-10-21
Status: Accepted

## Context

The step panel linked to each pipeline's README on GitHub `main`. `main` holds the latest version,
while a workspace may run an older one, so the README could describe parameters or behaviour that
the installed version does not have. Every SNT pipeline ships a `readme.md` next to its
`pipeline.py`, so the README of the deployed version is part of that version's code.

The webapp cannot read that code itself. `PIPELINES_READ` unlocks `pipelineVersion`, but the
proxy grants no webapp scope `PipelineVersion.files` (or `zipfile`), so the query is refused
([OH-3](../BACKLOG.md#oh-3)). `create_pipeline_cards` already reads `currentVersion.files` with
their content, to find the function name in `pipeline.py`.

## Decision

- `create_pipeline_cards` writes the root-level `readme.md` (matched case-insensitively) of each
  curated pipeline's deployed version to `readmes/<id>.md` next to the catalog. It empties
  `readmes/` first, so the folder only holds the current catalog's READMEs.
- The app shows the README in a collapsible **Documentation** section, which starts collapsed. The
  file is fetched with `FILES_READ` the first time the section is opened, then cached for the
  session. A small dependency-free Markdown renderer in `app.js` renders it (R6, R8).
- No link to GitHub anymore, not even as a fallback. Without a README in the bucket, the section
  says to re-run *Create pipeline_cards*.
- The README is shown as written, in whatever language it has; it is not translated.

## Consequences

- The documentation matches the installed version, as the parameter form already does
  ([ADR 0003](0003-catalog-parameters-from-deployed-version.md)). It drifts the same way: updating a
  pipeline without re-running the generator leaves the old README.
- A not-installed step shows no README (there is no deployed version to read it from).
- The README path is a second bucket-key contract between `config.py` (`OUTPUT_DIR` +
  `README_DIR`) and `app.js` (`README_DIR_KEY`).
- If OpenHEXA grants `PipelineVersion.files` to a webapp scope (OH-3), the app could read the
  README directly and the copies could go.
