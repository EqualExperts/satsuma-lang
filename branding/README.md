# Satsuma Brand Guide

This directory contains the brand identity for the Satsuma project. The prompt below can be pasted directly into an LLM or image generator to produce consistent, on-brand results.

---

## Brand Prompt

Copy and paste everything below the line into any LLM or image generation tool for consistent Satsuma branding.

---

### Satsuma — Brand Identity

**What Satsuma is:** A domain-specific language for source-to-target data mapping. It replaces scattered spreadsheets, wiki pages, and YAML files with a single, readable, parseable format. Think "DBML for data mappings." It is human-readable (business analysts can review it), machine-parseable (tree-sitter grammar with deterministic tooling), and readable and writable by AI tools as well as people.

**The name:** Satsuma is a citrus fruit — small, sweet, easy to peel. The name evokes something that is approachable, well-structured (segments), and satisfying. The project takes its visual identity from the fruit.

---

### Logo

The Satsuma logo is a **cross-section of a satsuma orange** viewed from above, showing the radial segment pattern, with a **small green leaf** attached at the upper right. Below the fruit is the word **"Satsuma"** in a friendly, rounded sans-serif typeface.

- The fruit cross-section uses warm orange tones with lighter segment lines
- The rind is a slightly darker orange ring
- The leaf is a natural green with a simple vein detail
- The overall style is **clean, flat illustration** — not photorealistic, not cartoonish
- The logo works on both light and dark backgrounds

Reference file: `../assets/satsuma-logo.png` (full logo with wordmark), `../assets/512x_satsuma_logo.png` (square icon)

---

### Colour Palette

| Role | Name | Hex | RGB | Usage |
|------|------|-----|-----|-------|
| **Primary** | Satsuma Orange | `#F2913D` | 242, 145, 61 | Buttons, links, primary accents, hero gradients |
| **Primary Dark** | Deep Orange | `#D97726` | 217, 119, 38 | Hover states, gradient endpoints, emphasis text |
| **Primary Light** | Soft Orange | `#F9B97A` | 249, 185, 122 | Borders, subtle highlights, tag backgrounds |
| **Accent** | Leaf Green | `#5A9E6F` | 90, 158, 111 | Secondary actions, success states, alternating sections |
| **Accent Dark** | Forest Green | `#3D7A52` | 61, 122, 82 | Green hover states, gradient endpoints |
| **Accent Light** | Mint Green | `#7DBF92` | 125, 191, 146 | Light green highlights, terminal text |
| **Background** | Warm Cream | `#FFFAF5` | 255, 250, 245 | Page backgrounds — never pure white |
| **Surface** | Light Peach | `#FFF3E8` | 255, 243, 232 | Cards, elevated surfaces, callout backgrounds |
| **Code Background** | Soft Amber | `#FEF7EE` | 254, 247, 238 | Code blocks, pre-formatted text areas |
| **Text Primary** | Warm Charcoal | `#2D2A26` | 45, 42, 38 | Headings, body text — never pure black |
| **Text Secondary** | Warm Gray | `#6B6560` | 107, 101, 96 | Descriptions, captions, secondary content |

**Gradient recipes:**
- Hero gradient: `linear-gradient(135deg, #FFFAF5 0%, #FFF3E8 50%, #FDE8D0 100%)`
- Orange button: `linear-gradient(135deg, #F2913D 0%, #D97726 100%)`
- Green button: `linear-gradient(135deg, #5A9E6F 0%, #3D7A52 100%)`

**Key principles:**
- Backgrounds are always warm (cream, peach) — never cold white or gray
- Orange is the dominant brand colour; green is the secondary accent
- Use orange for primary CTAs; green for secondary or success-related elements
- Dark charcoal for text, never pure black (#000)
- The palette should feel warm, approachable, and professional — like a sunny citrus grove, not a corporate dashboard

---

### Typography

| Role | Font | Weight | Fallback |
|------|------|--------|----------|
| **Headings** | Inter | 700–800 (Bold/ExtraBold) | system-ui, sans-serif |
| **Body** | Inter | 400–500 (Regular/Medium) | system-ui, sans-serif |
| **UI Labels** | Inter | 500–600 (Medium/SemiBold) | system-ui, sans-serif |
| **Code** | JetBrains Mono | 400–500 | monospace |

**Type scale (desktop):**
- Hero heading: 3.75rem (60px), ExtraBold, tight leading
- Section heading: 2.25rem (36px), Bold
- Card heading: 1.125rem (18px), Bold
- Body: 1rem (16px), Regular, relaxed leading (1.625)
- Small/caption: 0.875rem (14px), Medium
- Code: 0.875rem (14px), Regular, generous leading (1.7)

**Principles:**
- Inter is clean, highly legible, and has a modern technical feel without being cold
- JetBrains Mono for all code — it's designed for readability in programming contexts
- Headings use tight letter-spacing; body uses natural spacing
- Never use decorative or serif fonts — the brand is technical and approachable

---

### Voice & Tone

**Brand voice:** Confident, clear, and approachable. Satsuma is a professional tool for enterprise data teams, but it doesn't talk down to people or hide behind jargon.

**Key attributes:**
- **Direct** — Lead with the point, not the preamble. "Satsuma traces lineage from source to target" not "With Satsuma, you can leverage our powerful lineage capabilities to..."
- **Warm** — Friendly without being casual. Like a knowledgeable colleague, not a salesperson or an academic paper.
- **Precise** — Use exact numbers and specifics. "16 CLI commands, 482 parser tests" not "many powerful features."
- **Inclusive** — Address all roles (BAs, engineers, architects, governance). Never assume everyone is a developer.
- **Honest** — State what Satsuma does and doesn't do. Don't oversell. The CLI extracts facts; it doesn't generate code.

**Phrasing patterns:**
- "Human-readable, machine-parseable" (the core tagline)
- "Single source of truth" (for mapping logic)
- "Parser-backed" (not regex heuristics)
- "For people and AI tools alike" (not "AI-native" or "AI-powered" — AI tools are one kind of reader, not the headline)
- "The mapping language" (not "a mapping framework" or "a mapping platform")

**Avoid:**
- Buzzwords: "leverage", "synergy", "revolutionize", "cutting-edge", "next-gen"
- Vague claims: "powerful", "robust", "enterprise-grade" without specifics
- Hype: "superpower", "dramatic", "high-fidelity"
- Claims about file size, token savings or better AI output — lead with readability instead
- Developer-only language when addressing mixed audiences
- Exclamation marks in body copy (reserve for genuinely exciting moments)

---

### Look and Feel

**Visual style:** Clean, warm, structured — like well-organised citrus segments.

**Imagery principles:**
- Flat illustration style, not 3D or photorealistic
- Warm lighting and soft shadows — nothing harsh or high-contrast
- Generous whitespace — let content breathe
- Rounded corners (0.75rem for cards, 0.375rem for buttons/pills)
- Subtle border strokes (1px, using light orange or charcoal at 5% opacity)
- Cards and surfaces use white or peach backgrounds with very subtle borders

**UI patterns:**
- Navigation: fixed top bar, logo left, links center, GitHub button right
- Hero sections: split layout (text left, visual right) on gradient cream background
- Feature grids: 2–4 column card layouts with hover lift effect
- Code blocks: amber-tinted background, window-chrome header (three dots), copy button
- Terminal blocks: dark (#1E1E1E) with coloured prompt/output text
- CTAs: orange gradient buttons with soft shadow; secondary buttons are white with subtle border

**Animation:**
- Scroll reveal: elements fade up gently (0.6s ease, 20px translate)
- Hover: cards lift 4px with shadow expansion; buttons deepen shadow
- No spinning, bouncing, or attention-grabbing animations — everything is smooth and understated

**Iconography:**
- Line-style SVG icons (stroke, not fill) at 24px
- 2px stroke weight, round caps and joins
- Use orange or green tint for icon containers; white icon on coloured background

---

### Image Generation Prompt Template

When generating images for the Satsuma project, prepend this context:

```
Create an image for Satsuma, a data mapping language project. The visual identity
is based on the satsuma citrus fruit — warm, structured, approachable. Use a colour
palette of warm orange (#F2913D), leaf green (#5A9E6F), cream (#FFFAF5), and warm
charcoal (#2D2A26). The style should be clean flat illustration with generous
whitespace, soft shadows, and rounded shapes. Nothing photorealistic or cartoonish.
The feeling should be professional yet friendly — like a well-designed developer tool
that's welcoming to non-developers too.
```

Then add the specific image request (e.g., "Create a hero banner showing...", "Design an icon for...", etc.)
