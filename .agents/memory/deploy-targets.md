---
name: Dual deploy targets (Cloudflare default + Vercel)
description: How this TanStack Start SSR app builds for two hosts; why the DEPLOY_TARGET toggle exists.
---

# Dual deploy targets

This app's build is driven by `@lovable.dev/vite-tanstack-config`, which bakes in
`@cloudflare/vite-plugin`. By default the build emits a **Cloudflare Worker**
(`dist/server/index.js` + `dist/server/wrangler.json`) — there is NO static
`index.html`. So any host treating it as a static SPA (e.g. Vercel's "Vite"
preset) returns 404.

## The toggle
`vite.config.ts` reads `process.env.DEPLOY_TARGET`. When it equals `vercel` it
passes `cloudflare: false` to the lovable config, which disables the Worker plugin
and makes the build emit a **portable Web-fetch server entry** at
`dist/server/server.js` (exports `default { fetch(request, env, ctx) }`). This
entry runs unmodified under Node (verified: SSRs a 200 HTML page).

**Why:** keeps the working Cloudflare path intact (`pnpm run deploy`) while
allowing a Vercel build without forking the config.

## Vercel wiring
- `vercel.json`: `buildCommand` = `DEPLOY_TARGET=vercel pnpm run build`,
  `outputDirectory` = `dist/client`, `framework: null`,
  `functions["api/server.js"]` pins `runtime nodejs22.x` and
  `includeFiles: "dist/server/**"` (force-ship all server chunks so route-split
  dynamic imports aren't dropped by file tracing), rewrite `/(.*)` → `/api/server`.
- `api/server.js`: Vercel Web handler — named exports GET/POST/PUT/PATCH/DELETE/
  OPTIONS/HEAD all forward to `dist/server/server.js`'s `fetch`. Web-handler style
  (not Node req/res) avoids body-parsing pitfalls for server-function POSTs.

## Gotchas / env
- The server bundle **externalizes** npm deps (react, @supabase/supabase-js, jspdf,
  recharts, h3-v2, pg, pdf-parse, …); Vercel ships them via NFT tracing from the
  function. `includeFiles` only covers `dist/server/**`, not node_modules — NFT
  handles those.
- `VITE_*` vars are inlined at **build** time, so `SUPABASE_URL`,
  `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` must be set as Vercel
  **build** env vars or the client gets an empty Supabase config.
- Server runtime secrets (`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `QBO_*`,
  etc.) read from `process.env` and must be set in Vercel project env.
- `QBO_REDIRECT_URI` must point at the deployed domain + `/api/qbo/callback`.
- The one thing only verifiable post-deploy: Vercel rewrites must preserve the
  original URL/path to the function (needed for SSR routing). Standard behavior,
  but confirm with a nested route + a direct `/assets/*` request after deploy.
