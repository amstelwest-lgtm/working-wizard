import { execSync } from "node:child_process";

/** Id baked into the bundle and written to /version.json. Prefer the deploy sha. */
export function currentBuildId(
  env: Record<string, string | undefined> = process.env,
): string {
  const fromCi = env.VERCEL_GIT_COMMIT_SHA?.trim() || env.GITHUB_SHA?.trim() || "";
  if (fromCi) return fromCi;
  try {
    const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    if (sha) return sha;
  } catch {
    // No git metadata in this environment.
  }
  return "development";
}

export function versionJson(buildId: string): string {
  return `${JSON.stringify({ buildId })}\n`;
}
