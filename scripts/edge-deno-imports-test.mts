/**
 * Edge functions deploy through a wrapper that imports the raw GitHub URL.
 * Deno resolves that graph as URLs, so every relative import reachable from
 * a supabase/functions index.ts needs an explicit .ts or .tsx extension.
 * Run: pnpm test:edge-deno-imports
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export type ExtensionlessImport = { from: string; spec: string };

const FROM_RE = /\b(?:import|export)\s+(?:type\s+)?[^"'`;]*?\sfrom\s+["']([^"']+)["']/g;
const SIDE_EFFECT_RE = /^\s*import\s+["']([^"']+)["']/gm;
const DYNAMIC_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

export function relativeImportSpecs(src: string): string[] {
  const text = stripComments(src);
  const specs: string[] = [];
  for (const re of [FROM_RE, SIDE_EFFECT_RE, DYNAMIC_RE]) {
    for (const match of text.matchAll(re)) {
      const spec = match[1];
      if (spec?.startsWith(".")) specs.push(spec);
    }
  }
  return specs;
}

export function extensionlessRelativeSpec(spec: string): boolean {
  const path = spec.split("?")[0] ?? spec;
  return !/\.(ts|tsx)$/.test(path);
}

function resolveRelative(fromFile: string, spec: string): string | null {
  const target = resolve(dirname(fromFile), spec.split("?")[0] ?? spec);
  const candidates = [target, `${target}.ts`, `${target}.tsx`, join(target, "index.ts")];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

/** Walk relative imports from entry files. `read` returns null when a file is absent. */
export function extensionlessRelativeImports(
  entries: string[],
  read: (file: string) => string | null,
  resolveImport: (fromFile: string, spec: string) => string | null,
): ExtensionlessImport[] {
  const hits: ExtensionlessImport[] = [];
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const src = read(file);
    if (src == null) continue;
    for (const spec of relativeImportSpecs(src)) {
      if (extensionlessRelativeSpec(spec)) hits.push({ from: file, spec });
      const next = resolveImport(file, spec);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return hits;
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const fixture = extensionlessRelativeImports(
  ["fn/index.ts"],
  (file) => {
    if (file === "fn/index.ts") return `import { paidGenerationTrialBlock } from "../_shared/starter-trial-gate.ts";`;
    if (file === "_shared/starter-trial-gate.ts") return `import { MESSAGE } from "../../src/lib/firm-starter-trial.ts";`;
    if (file === "src/lib/firm-starter-trial.ts") return `import { FIRM_TRIAL_DAYS } from "./stripe-plans";`;
    return null;
  },
  (fromFile, spec) => {
    if (fromFile === "fn/index.ts" && spec.endsWith("starter-trial-gate.ts")) return "_shared/starter-trial-gate.ts";
    if (fromFile === "_shared/starter-trial-gate.ts" && spec.endsWith("firm-starter-trial.ts")) {
      return "src/lib/firm-starter-trial.ts";
    }
    return null;
  },
);
assert(
  fixture.some((hit) => hit.from === "src/lib/firm-starter-trial.ts" && hit.spec === "./stripe-plans"),
  "the walker flags an extensionless import deeper in the edge graph",
);
assert(
  !extensionlessRelativeSpec("../_shared/starter-trial-gate.ts"),
  "an explicit .ts import is allowed",
);
assert(extensionlessRelativeSpec("./firm-starter-trial"), "an extensionless relative import is rejected");

const functionsRoot = resolve("supabase/functions");
const entries = readdirSync(functionsRoot)
  .map((name) => join(functionsRoot, name, "index.ts"))
  .filter((file) => existsSync(file));
assert(entries.length > 0, "supabase/functions has index.ts entry points");

const hits = extensionlessRelativeImports(
  entries,
  (file) => (existsSync(file) ? readFileSync(file, "utf8") : null),
  resolveRelative,
);
assert(
  hits.length === 0,
  `relative edge imports need a .ts or .tsx extension:\n${hits
    .map((hit) => `  ${relative(process.cwd(), hit.from)} -> ${hit.spec}`)
    .join("\n")}`,
);

const gate = readFileSync(resolve("supabase/functions/_shared/starter-trial-gate.ts"), "utf8");
assert(
  gate.includes("../../../src/lib/starter-trial-constants.ts"),
  "the edge gate imports the dependency-free constants module",
);
assert(!gate.includes("firm-starter-trial"), "the edge gate does not import the Stripe trial clock");
assert(!gate.includes("stripe-plans"), "the edge gate does not import the plan catalog");
assert(!gate.toLowerCase().includes("stripe"), "the edge gate does not mention Stripe");

console.log("edge-deno-imports ok");
