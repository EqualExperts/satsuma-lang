---
id: sl-tl1j
status: closed
deps: [sl-ncu9]
links: []
created: 2026-06-09T21:15:33Z
type: task
priority: 2
assignee: Thorben Louw
tags: [live-editor, site]
---
# Feature 33 — site integration: nav, home CTA, deploy copy, README links

Publish the static playground under /playground/ and link it from the site. Add the deploy-workflow step that copies the built static bundle into site/playground/ before Eleventy runs (mirroring the existing 'copy diary content' step in deploy-site.yml). Add a 'Try it Live!' entry to site/_includes/nav.njk (desktop AND mobile menus) and a prominent home-page CTA, both linking to /playground/. Update README.md to add (a) a 'Try it Live!' link to the playground and (b) a link to the published GitHub Pages site. The playground README link must land WITH this feature once /playground/ is deployed — never ahead of it (no 404); the plain site link may land independently.

## Design

Eleventy uses no pathPrefix and templates use page-relative asset paths, so a copied site/playground/ resolves under https://equalexperts.github.io/satsuma-lang/playground/ automatically.

## Acceptance Criteria

'Try it Live!' appears in nav (desktop + mobile) and as a home-page CTA linking to /playground/; deploy workflow copies the static bundle into site/ before the Eleventy build; the published playground loads and renders a seeded example under the GitHub Pages base path; README links to both the published site and the playground (playground link merged together with the deployed build).


## Notes

**2026-06-10T01:30:00+01:00**

Cause: Feature work — the playground bundle existed (sl-ncu9) but was not published or linked anywhere on the site or README.
Fix: deploy-site.yml builds the bundle (ci:all + tree-sitter WASM + build:playground) and copies it into site/playground/ before Eleventy, which ignores+passes it through verbatim (verified byte-identical locally); "Try it Live!" added to desktop/mobile nav and as the primary home CTA; README links playground + site together with the deploy step (commit 69fe254)
