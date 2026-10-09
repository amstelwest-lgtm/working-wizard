/**
 * Marketing header Sign in, and where a successful landing-modal sign-in goes.
 * Run: pnpm test:marketing-sign-in
 * CI:  included in pnpm test:ci
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  destinationAfterLandingSignIn,
  resolveLandingSignInDestination,
  type LandingSignInRoles,
} from "../src/lib/landing-sign-in-destination";
import { peekForcePortal, clearForcePortal, PORTAL_FORCE_KEY } from "../src/lib/user-roles";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const shell = read("src/components/marketing-shell.tsx");
const button = read("src/components/landing/landing-sign-in-button.tsx");
const session = read("src/components/landing/landing-sign-in-session.tsx");
const destination = read("src/lib/landing-sign-in-destination.ts");
const index = read("src/routes/index.tsx");
const accountants = read("src/routes/for-accountants.tsx");
const owners = read("src/routes/for-owners.tsx");
const about = read("src/routes/about.tsx");
const faq = read("src/routes/faq.tsx");
const authHook = read("src/hooks/use-auth.tsx");
const modal = read("src/components/landing/sign-in-modal.tsx");

const header = shell.slice(
  shell.indexOf('<header className="mk-top">'),
  shell.indexOf("</header>"),
);
assert(header.includes("<MarketingSignIn />"), "marketing header renders Sign in");
assert(header.includes('className="mk-top-link" href="/faq"'), "Questions stays in the header");
const signInAt = header.indexOf("<MarketingSignIn />");
const ctaAt = header.indexOf("mk-top-cta");
assert(signInAt !== -1 && ctaAt !== -1 && signInAt < ctaAt, "Sign in sits before the header CTA");
assert(shell.includes('className="mk-top-signin"'), "Sign in uses the marketing header class");
assert(
  button.includes(">Sign in<") || button.includes("Sign in\n"),
  "shared control label is Sign in",
);
assert(
  button.includes('className = "btn btn-ghost nav-signin"'),
  "homepage default class stays nav-signin",
);

assert(accountants.includes("MarketingShell"), "/for-accountants uses the marketing header");
assert(owners.includes("MarketingShell"), "/for-owners uses the marketing header");
assert(about.includes("MarketingShell"), "/about uses the marketing header");
assert(faq.includes("MarketingShell"), "/faq uses the marketing header");
assert(!accountants.includes("supabase"), "/for-accountants does not import Supabase");
assert(
  !owners.includes("door=") && !owners.includes("accountant door"),
  "owner pages keep the owner door",
);

assert(
  !shell.includes('from "@/integrations/supabase/client"'),
  "marketing shell does not statically import Supabase",
);
assert(
  !shell.includes('from "@/components/landing/landing-sign-in-session"'),
  "sign-in session is not in the marketing shell's static graph",
);
assert(
  shell.includes('import("@/components/landing/landing-sign-in-session")'),
  "Sign in loads the modal session on click",
);
assert(
  shell.includes("createPortal") && shell.includes("[data-milon-marketing]"),
  "sign-in modal is portaled out of the backdrop-filter header",
);
assert(!shell.includes('from "@/hooks/use-auth"'), "marketing shell does not attach auth on paint");

assert(session.includes("LandingSignInModal"), "marketing Sign in opens the landing modal");
assert(session.includes("wakeAuth()"), "opening Sign in wakes auth");
assert(
  session.includes("resolveLandingSignInDestination"),
  "marketing sign-in uses the shared redirect",
);
assert(
  session.includes('import("@/integrations/supabase/client")'),
  "marketing password grant loads Supabase on submit",
);
assert(modal.includes('intent="owner"'), "landing modal Google stays the owner door");

const nav = index.slice(
  index.indexOf('<nav id="topnav"'),
  index.indexOf("{/* ══════════════════════════ HERO"),
);
assert(nav.includes("nav-signin"), "homepage Sign in stays a ghost button");
assert(nav.includes("LandingSignInButton"), "homepage uses the shared Sign in control");
assert(
  index.includes("@/lib/landing-sign-in-destination"),
  "homepage sign-in uses the shared redirect",
);
assert(
  !index.includes('from "@/integrations/supabase/client"'),
  "homepage does not statically import Supabase",
);
assert(
  index.includes('import("@/integrations/supabase/client")'),
  "homepage loads Supabase on intent",
);

assert(
  !authHook.includes('from "@/integrations/supabase/client"'),
  "use-auth does not import Supabase up front",
);
assert(
  authHook.includes('import("@/integrations/supabase/client")'),
  "use-auth loads Supabase lazily",
);
assert(
  authHook.includes("isPublicMarketingPath"),
  "public pages skip Supabase until wake or a session",
);
assert(authHook.includes("wakeAuth"), "wakeAuth is the click path");
assert(destination.includes("forcePortal"), "successful sign-in still pins a door");

const owner: LandingSignInRoles = {
  hasPracticeRole: false,
  hasClientRole: true,
  hasFirm: false,
  practiceSignup: false,
};
const accountant: LandingSignInRoles = {
  hasPracticeRole: true,
  hasClientRole: false,
  hasFirm: true,
  practiceSignup: true,
};
const dual: LandingSignInRoles = {
  hasPracticeRole: true,
  hasClientRole: true,
  hasFirm: true,
  practiceSignup: true,
};
const firmOnly: LandingSignInRoles = {
  hasPracticeRole: false,
  hasClientRole: false,
  hasFirm: true,
  practiceSignup: false,
};

assert(destinationAfterLandingSignIn(owner) === "/app", "owner sign-in opens /app");
assert(
  destinationAfterLandingSignIn(accountant) === "/dashboard",
  "practice-only sign-in opens /dashboard",
);
assert(
  destinationAfterLandingSignIn(dual) === "/app",
  "owner door keeps a dual-role account on /app",
);
assert(
  destinationAfterLandingSignIn(firmOnly) === "/dashboard",
  "firm account with no client seat opens /dashboard",
);
assert(
  destinationAfterLandingSignIn({
    hasPracticeRole: false,
    hasClientRole: false,
    hasFirm: false,
    practiceSignup: false,
  }) === "/app",
  "a new owner with no roles opens /app",
);

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

const sessionStore = new MemoryStorage();
const localStore = new MemoryStorage();
const g = globalThis as unknown as { window?: { sessionStorage: Storage; localStorage: Storage } };
const prevWindow = g.window;
g.window = { sessionStorage: sessionStore, localStorage: localStore };

const accountantPath = await resolveLandingSignInDestination("acct", async () => accountant);
assert(accountantPath === "/dashboard", "stubbed accountant sign-in navigates to /dashboard");
assert(peekForcePortal() === "accountant", "accountant sign-in pins the accountant door");
assert(
  sessionStore.getItem(PORTAL_FORCE_KEY) === "accountant",
  "accountant force is session-scoped",
);
clearForcePortal();

const ownerPath = await resolveLandingSignInDestination("owner", async () => owner);
assert(ownerPath === "/app", "stubbed owner sign-in navigates to /app");
assert(peekForcePortal() === "owner", "owner sign-in pins the owner door");

const dualPath = await resolveLandingSignInDestination("dual", async () => dual);
assert(dualPath === "/app", "stubbed dual-role sign-in stays on the owner door");
assert(peekForcePortal() === "owner", "dual-role owner door force stays owner");

if (prevWindow === undefined) delete g.window;
else g.window = prevWindow;

console.log("marketing-sign-in: ok");
