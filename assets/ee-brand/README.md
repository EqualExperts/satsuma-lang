# Equal Experts brand assets

This directory holds the official Equal Experts brand assets used to identify
Satsuma as an Equal Experts open-source project. They are distributed here under
EE permission for use in this repository and its derivatives; they are not
generic-purpose assets — please do not delete, rename, or replace them without
checking with the maintainers.

The summary of the EE brand guidelines kept alongside these files
([`brand-guidelines-summary.md`](brand-guidelines-summary.md)) records the
palette, typography, and visual motifs Equal Experts uses in its own materials.
Satsuma keeps its existing visual identity (see [`../../branding/README.md`](../../branding/README.md));
the EE guidelines are kept here only as reference material when deciding *how*
to place the EE logo alongside Satsuma's own.

| File | Description | Where it is used |
|---|---|---|
| `ee-logo-colour.png` | Full-colour EE wordmark (blue brand mark + dark text). | README header, where the page background is light. |
| `ee-logo-black.png` | All-black monochrome wordmark. | Site footer, where tonal consistency with the existing dark page chrome is required. |
| `ee-logo-white.png` | Reversed (all-white) wordmark. | Reserved for any dark-background surface added in the future. |
| `ee-brand-mark.png` | The `[ee]` bracket mark on its own, without the wordmark. | Site top navigation, where the link must read as a small logo at GitHub-button height. |

The PNGs in `site/img/` (`ee-logo-black.png`, `ee-brand-mark.png`) are mirrored
copies of the files above, kept there so the static site build can reference
them with relative paths inside `site/`. Keep the two copies in sync if these
assets are ever refreshed.

## Tagline

The canonical phrase used wherever EE attribution appears is:

> An Equal Experts open-source project

Use it verbatim — do not vary it.
