---
name: Global context provider placement
description: Where to put context providers that need to be accessible across routes
---

Context providers that must be accessible to any component (including route-level components like `app.tsx`) must be placed in `__root.tsx`, not inside the route component itself.

Current provider stack in `__root.tsx` (inside-out):
1. QueryClientProvider
2. AuthProvider
3. AccountantProfileProvider
4. AnalyticsProvider
5. NotesProvider
6. ViewModeProvider
7. Outlet

**Why:** If a provider is placed inside a component that also calls `useContext` for that provider, the hook call is outside the provider boundary. All route components render as `<Outlet />` children, so providers must wrap the Outlet in __root.tsx.

**How to apply:** Any new global context (feature flags, theme overrides, etc.) should be added to the provider stack in __root.tsx.
