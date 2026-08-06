---
id: vnm-gucl
status: open
deps: []
links: []
created: 2026-08-06T17:24:08Z
type: bug
priority: 3
assignee: Thorben Louw
external-ref: gh-513
tags: [viz, ux, docs]
---
# viz: canvas hint says "drag to pan" but only middle-mouse (or Alt) drag pans

From GitHub issue #513 (https://github.com/EqualExperts/satsuma-lang/issues/513). The issue opened by asking for Miro/Figma-style canvas panning — left-drag on empty canvas, Spacebar+drag, and grab/grabbing cursor feedback — on the grounds that panning was only possible through the overview minimap. The reporter then found that **middle-mouse drag already pans**, and concluded the real defect is that the on-screen hint does not say so. This ticket implements that conclusion, which the user has accepted.

**The change.** In `tooling/satsuma-viz-harness/src/client/index.html:497`, replace:

    Ctrl+scroll to zoom &middot; drag to pan &middot; use Fit button inside

with:

    Ctrl+scroll to zoom &middot; middle mouse drag to pan &middot; use Fit button inside

**Why the current wording misleads.** "drag to pan" is simply not true of a plain left-drag. `tooling/satsuma-viz/src/satsuma-viz.ts:1917` gates panning on `e.button === 1 || (e.button === 0 && e.altKey)` — middle-button drag, or Alt held with left-drag. A reader who follows the hint literally left-drags, nothing pans, and they fall back to the minimap. That is exactly the journey #513 describes.

The cursor feedback the issue asks for is already half-present: `satsuma-viz.ts:1925` sets `cursor: grabbing` while a pan is in progress and clears it at `:1938`. There is no `grab` cursor on hover, because there is no hover state that means "panning is available here" when the gesture is bound to a button the cursor cannot advertise.

**Scope.**

- The hint string occurs in exactly one place in the repo — the harness client. The VS Code webview and the site playground render no equivalent hint at all, so this ticket makes no change there. Whether those two hosts should also show it is worth a look while in the area; if they should, note it rather than expanding this ticket silently.
- Alt+left-drag also pans and the accepted wording does not mention it. Left as-is deliberately: the user chose this exact string, and a hint that lists every binding stops being a hint. Worth mentioning in user docs instead if anywhere.
- **Not covered here:** the original #513 request for left-drag-on-empty-canvas panning, Spacebar+drag, and a `grab` cursor on hover. Accepting the wording fix does not close that ask — it makes the existing behaviour discoverable. If the interaction work is still wanted, it needs its own ticket; flag this to the user before closing #513 so the issue is not closed on a strictly smaller change than it requested.

## Acceptance Criteria

- The harness toolbar hint reads exactly `Ctrl+scroll to zoom · middle mouse drag to pan · use Fit button inside`.
- No behavioural change to panning or zooming — this is a copy fix only.
- If any harness assertion or screenshot baseline pins the old hint text, it is updated in the same change.
- Before the ticket closes, the user is told whether #513's interaction request (left-drag / Spacebar panning, hover `grab` cursor) is being carried into a follow-up ticket or dropped, so the GitHub issue is resolved on an accurate basis.

