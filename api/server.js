// Vercel serverless function (Node.js runtime) that wraps the portable TanStack
// Start server entry produced by `DEPLOY_TARGET=vercel pnpm run build`.
//
// The entry exports a Web-standard `{ fetch(request) }` handler. Vercel's Web
// handler API lets us forward each HTTP method straight to it, so the SSR router
// receives the original request (path + body) untouched. All routes are rewritten
// to this function via vercel.json; the original URL is preserved by the rewrite.
import handler from "../dist/server/server.js";

const forward = (request) => handler.fetch(request);

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
export const OPTIONS = forward;
export const HEAD = forward;
