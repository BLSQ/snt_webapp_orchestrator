# 0014. Ship OpenHEXA's `dev.js` in the bundle for local development

Date: 2026-10-20
Status: Accepted (amends the "no CDN scripts" rule of [0007](0007-multi-file-bundle-no-build.md))

## Context

Every change to the bundle had to be deployed to a workspace to be seen against real data. OpenHEXA
publishes `https://api.openhexa.org/webapps/dev.js`. With it, a page served on `localhost` (or
`file://`) calls a real workspace's `/graphql/` proxy through a deployed private webapp, under that
webapp's own scopes. OpenHEXA's default webapp template already includes the tag.

[ADR 0007](0007-multi-file-bundle-no-build.md) forbids CDN scripts and makes any new script tag a
reviewed change (backlog item DEV-1, closed by this ADR).

## Decision

- `index.html` loads `dev.js` as a plain script **immediately before `app.js`** (no `async` /
  `defer`): it must set `window.OPENHEXA` and the `/graphql/` reroute before the app boots.
- The tag carries **no `data-workspace-slug` / `data-webapp-slug`**: the bundle stays
  workspace-independent (R6), and the developer picks the webapp in the Connect picker.
- `dev.js` is the **only** third-party script allowed. ADR 0007's rule stands for everything else.
- `app.js` detects the same local hosts (`isLocalDev()`) only to word the "not connected yet" boot
  error. It changes no other behaviour.

## Consequences

- Bundle edits can be tried locally against live data with no deploy
  ([`DEPLOYMENT.md`](../DEPLOYMENT.md#developing-locally)).
- The deployed app downloads ~10 KB of OpenHEXA code on every load. It returns at once on a
  non-local host, so it does nothing there. If `api.openhexa.org` is unreachable, the tag fails
  and `app.js` still runs.
- The script is served by OpenHEXA and can change without our review. It is the platform the
  app already depends on, and the trust is the same as for the proxy.
- The bundle is still five files and still byte-for-byte what is deployed.
