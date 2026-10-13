/**
 * Phone side menu: a tap outside, Escape, and the corner X close it
 * on the owner door and the accountant rails (including client sub-pages).
 * Run: pnpm test:drawer-dismiss
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const read = (path: string) => readFileSync(resolve(path), "utf8");

function between(src: string, start: string, end: string) {
  const at = src.indexOf(start);
  const to = src.indexOf(end, at + start.length);
  assert(at !== -1 && to > at, `missing ${start} .. ${end}`);
  return src.slice(at, to);
}

const owner = read("src/components/owner-door/owner-shell.tsx");
const practice = read("src/components/practice-board.tsx");
const settings = read("src/components/settings-shell.tsx");
const client = read("src/routes/_authenticated/clients.$clientId.tsx");
const nav = read("src/components/accountant-nav.tsx");
const portalCss = read("src/styles/accountant-portal.css");
const ownerCss = read("src/components/owner-door/owner-door.css");

function backdropSitsBesideTheRail(src: string, label: string) {
  const workspaceAt = src.indexOf('className="client-workspace"');
  assert(workspaceAt !== -1, `${label} has a workspace`);
  const topbarAt = src.lastIndexOf('className="topbar"', workspaceAt);
  const headerAt = src.lastIndexOf("<header", workspaceAt);
  const barAt = Math.max(topbarAt, headerAt);
  assert(barAt !== -1, `${label} has a top bar`);
  const bar = src.slice(barAt, workspaceAt);
  assert(!bar.includes("<DrawerBackdrop") && !bar.includes("topbar-backdrop"), `${label} backdrop is outside the top bar`);
  const workspace = src.slice(workspaceAt, workspaceAt + 700);
  assert(workspace.includes("<DrawerBackdrop"), `${label} backdrop covers the page beside the drawer`);
}

backdropSitsBesideTheRail(owner, "owner");
backdropSitsBesideTheRail(practice, "practice");
backdropSitsBesideTheRail(settings, "settings");
backdropSitsBesideTheRail(client, "client");

assert(owner.includes("<DrawerCloseButton"), "owner drawer has a close button");
assert(between(owner, "<nav", "</nav>").includes("<DrawerCloseButton"), "the owner close button sits in the drawer");
assert(nav.includes("<DrawerCloseButton"), "accountant rails share the close button");
assert(nav.includes("nav-sub-link"), "client sub-pages stay in that drawer");
assert(nav.includes('aria-label="Close menu"'), "the close button is named");
assert(nav.includes('event.key === "Escape"'), "escape closes the shared drawer");
assert(nav.includes("onCloseRef.current?.()"), "escape uses the page close handler");

assert(owner.includes('event.key !== "Escape"') && owner.includes("setNavOpen(false)"), "escape closes the owner drawer");
assert(practice.includes('event.key === "Escape"') && practice.includes("setMobileNavOpen(false)"), "escape closes the practice drawer");
assert(settings.includes('event.key === "Escape"') && settings.includes("setMenuOpen(false)"), "escape closes the settings drawer");
assert(client.includes('event.key === "Escape"') && client.includes("setMobileNavOpen(false)"), "escape closes the client drawer");

assert(
  portalCss.includes(".accountant-portal.nav-open .deliverable-rail .drawer-close") &&
    portalCss.includes("display:grid"),
  "the close button is visible while the phone drawer is open",
);
assert(portalCss.includes(".drawer-close{\n  display:none"), "the close button stays off the desktop rail");
assert(
  ownerCss.includes(".owner-door.accountant-portal.nav-open .topbar-backdrop") &&
    ownerCss.includes("inset: 0"),
  "the owner overlay covers the screen",
);
assert(
  portalCss.includes(".accountant-portal.nav-open .topbar-backdrop{") && portalCss.includes("inset:0"),
  "the accountant overlay covers the screen",
);

console.log("drawer-dismiss: ok");
