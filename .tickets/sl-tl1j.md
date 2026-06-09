---
id: sl-tl1j
status: in_progress
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

