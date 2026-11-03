/**
 * Edge functions stay per company. A login is not resolved to one client.
 * Run: pnpm test:client-groups-edge-audit
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../supabase/functions/", import.meta.url));

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function source(file: string): string {
  return readFileSync(file, "utf8");
}

test("agents stay on this one client", () => {
  const prompts = [
    "_shared/agent-prompts/advisor.ts",
    "_shared/agent-prompts/analyst.ts",
    "_shared/agent-prompts/financial-manager.ts",
    "_shared/agent-core/loop.ts",
  ];
  for (const file of prompts) {
    assert.match(source(path.join(root, file)), /this one client/);
  }
});

test("no edge function loads the one client for a login", () => {
  const hits: string[] = [];
  for (const file of files(root)) {
    const text = source(file);
    const fromClients = text.split(/\.from\(\s*["']clients["']\)/);
    for (const chunk of fromClients.slice(1)) {
      const window = chunk.slice(0, 500);
      const byOwner = /\.eq\(\s*["']owner_user_id["']/.test(window);
      const oneRow = /\.limit\(\s*1\s*\)|\.maybeSingle\(/.test(window);
      if (byOwner && oneRow) hits.push(path.relative(root, file));
    }
  }
  assert.deepEqual(hits, []);
});

test("client-scoped functions still read owner_user_id for that company id", () => {
  const scoped = [
    "milon-bot/index.ts",
    "owner-handoff/index.ts",
    "task-link/index.ts",
    "agent-draft-decision/index.ts",
  ];
  for (const file of scoped) {
    const text = source(path.join(root, file));
    assert.match(text, /owner_user_id/);
    assert.match(text, /\.eq\(\s*["']id["']/);
  }
});
