---
name: react-pdf rendering gotchas
description: Layout and font-encoding constraints when rendering PDFs with @react-pdf/renderer and built-in Helvetica
---

# react-pdf rendering constraints

## Absolute positioning anchors to the nearest wrapper, even a zero-height one
Absolutely positioned chart elements must be direct children of their sized container (use `Fragment` for map keys, not a plain `View` wrapper). A zero-height wrapper sits at the container top, so `bottom: N` children render above the chart and overlap earlier content.
**Why:** discovered when redesigned bar charts painted over the section above them.

## Built-in Helvetica is WinAnsi-only — many glyphs silently break
Missing glyphs render blank/garbage: ▲ ▼ → ↑ ↓, true minus (U+2212), and ō. Draw arrows/diacritics as small border/View shapes instead, and use ASCII hyphen for minus. Safe: × · — – … •.

## Headless verification
PDF render crashes only surface on download; verify headlessly with `renderToBuffer` via `vite-node` (resolves path aliases) and rasterize with `pdftoppm` for visual checks.
