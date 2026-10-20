# 0010. The SaaS front-end base `app.openhexa.org` is hardcoded

Date: not recorded (the `.io` / `.org` split behind it was found on 2026-06-18)
Status: Accepted

## Context

The app links out to OpenHEXA pages: a pipeline run, an output dataset, the generator's template.
On the SaaS, static webapps are served from `*.openhexa.io` (e.g. `<webapp-slug>.openhexa.io`),
but the main UI lives at `app.openhexa.org` — a different domain. Deriving the host from the
webapp's hostname gives `app.openhexa.io`, which OpenHEXA treats as a webapp named `app` and
answers with a "Web app not found" 404. `window.OPENHEXA` does not expose the front-end base.

## Decision

`app.js` hardcodes the front-end base `https://app.openhexa.org` for every link to the OpenHEXA
UI. It is never derived from `location.hostname`.

## Consequences

- Links work on the SaaS in every workspace with no configuration.
- A self-hosted OpenHEXA install would get links to the SaaS. Supporting one needs a change
  ([PLAT-1](../BACKLOG.md#plat-1)).
- The same applies to the generator's template deep link, which is built from the template's
  display name (`GENERATOR_TEMPLATE_NAME`); renaming the template breaks that link silently.

Sources: former `CLAUDE.md` *Constructing OpenHEXA front-end URLs*;
[`../OPENHEXA_WEBAPP_RUNTIME.md`](../OPENHEXA_WEBAPP_RUNTIME.md#openhexa-front-end-urls).
