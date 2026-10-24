/**
 * Every face in the avatar registry, including the Tax Specialist,
 * must resolve to a real file under public/avatars.
 * Run: pnpm test:avatar-face-registry
 */
import { existsSync, statSync } from "node:fs";
import {
  AVATAR_FOLDERS,
  FM_AVATAR_CLIPS,
  avatarPoster,
  fmClipSources,
  type AvatarFace,
} from "../src/lib/fm-avatar-state.ts";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function publicFile(href: string): string {
  const path = href.split("?")[0] ?? href;
  assert(path.startsWith("/avatars/"), `${href} is served from /avatars`);
  return `public${path}`;
}

function assertAsset(agent: AvatarFace, href: string, label: string) {
  const file = publicFile(href);
  assert(existsSync(file), `${agent} ${label} is missing (${href})`);
  const size = statSync(file).size;
  assert(size > 500, `${agent} ${label} is not a real asset (${href}, ${size} bytes)`);
}

const agents = Object.keys(AVATAR_FOLDERS) as AvatarFace[];

assert(agents.includes("tax_specialist"), "the tax specialist is in the face registry");
assert(agents.includes("financial_manager"), "the financial manager is in the face registry");
assert(agents.includes("analyst"), "the analyst is in the face registry");
assert(agents.includes("advisor"), "the advisor is in the face registry");
assert(AVATAR_FOLDERS.tax_specialist === "tax", "the tax specialist uses the tax folder");

for (const agent of agents) {
  const poster = avatarPoster(agent);
  assertAsset(agent, poster.webp, "poster webp");
  assertAsset(agent, poster.jpg, "poster jpg");
  for (const clip of FM_AVATAR_CLIPS) {
    const sources = fmClipSources(clip, agent);
    assertAsset(agent, sources.webm, `${clip} webm`);
    assertAsset(agent, sources.mp4, `${clip} mp4`);
  }
}

console.log(`avatar face registry ok (${agents.length} agents)`);
