---
name: Standalone dark pages need .dark class
description: Global light-mode CSS overrides break always-dark standalone routes unless html has .dark
---
Rule: any always-dark standalone route (e.g. public token pages) must add the `dark` class to `document.documentElement` on mount (and restore on unmount).

**Why:** `src/styles.css` has aggressive `html:not(.dark)` overrides (e.g. all h1–h6 forced to `#0b1220 !important`), which render dark-on-dark invisible text on pages that style themselves dark without the class.

**How to apply:** in the route component, `useEffect` that adds `dark` to the html element, removing it on unmount only if it wasn't already there.
