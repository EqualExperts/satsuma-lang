# Site Development

The site is built with [Eleventy (11ty)](https://www.11ty.dev/) using Nunjucks templates.

> The site is **deliberately not an npm workspace member**: the root
> `package.json` globs `tooling/*` only, and `site/package-lock.json` is its own.
> It is a separate deployable with its own toolchain, so its dependencies install
> here rather than hoisting to the root — do not delete that lockfile or fold it
> into the root one.

## Local Preview

```bash
cd site
npm install
npx @11ty/eleventy --serve
```

Open `http://localhost:8080` to preview. Changes to `.njk`, `_includes/`, `_data/`, CSS, and JS files trigger live reload.

## Structure

| Path | Purpose |
|------|---------|
| `_layouts/default.njk` | Base layout (head + nav + content + footer + scripts) |
| `_includes/head.njk` | Shared `<head>`: meta, fonts, Tailwind config |
| `_includes/nav.njk` | Navigation bar with active-state logic via `nav_id` |
| `_includes/footer.njk` | Footer with version tokens from `_data/site.json` |
| `_data/site.json` | Version data (written by CI, placeholder for local dev) |
| `*.njk` | Page templates (index, cli, vscode, examples, learn) |
| `css/`, `js/`, `img/` | Static assets (passthrough copied to `_site/`) |

## Adding/Editing Content

- **Edit a page:** Modify the corresponding `.njk` file. Page-specific content is plain HTML with Tailwind classes.
- **Edit shared chrome:** Modify files in `_includes/` (nav, footer, head).
- **Change version:** Edit `_data/site.json` (CI writes this automatically during deploy).
- **Add a new page:** Create a new `.njk` file with front matter:

```yaml
---
layout: default.njk
title: "Page Title"
description: "Page description"
nav_id: page-id
permalink: page.html
---
```

## Deployment

The site deploys to GitHub Pages via `.github/workflows/deploy-site.yml`. On push to `main` (when `site/**` changes) or on release:

1. Writes version data from `VERSION` file to `_data/site.json`
2. Runs `npm ci && npx @11ty/eleventy` to build
3. Uploads `_site/` to GitHub Pages
