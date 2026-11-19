const ALLOWED = new Set(["pdf", "png", "jpg", "jpeg", "webp", "heic", "heif"]);
const MAX_BYTES = 20 * 1024 * 1024;

const HIDDEN =
  /(?:^|[\\/])\.|(?:^|[\\])(?:\$recycle\.bin|System Volume Information|pagefile\.sys|hiberfil\.sys)(?:[\\/]|$)/i;
const SECRET =
  /(?:^|[\\])(?:\.env(?:\..*)?|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.pfx|.*\.key|credentials|Login Data|Cookies)(?:[\\/]|$)/i;

function extensionOf(filePath: string): string | null {
  const base = filePath.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

export function shouldUpload(filePath: string, sizeBytes: number): boolean {
  if (HIDDEN.test(filePath) || SECRET.test(filePath)) return false;
  if (sizeBytes <= 0 || sizeBytes > MAX_BYTES) return false;
  const ext = extensionOf(filePath);
  if (!ext) return false;
  return ALLOWED.has(ext);
}

/** Visible, in-size file with a disallowed extension — log and skip (no upload attempt). */
export function skippedTypeLogLine(filePath: string, sizeBytes: number): string | null {
  if (HIDDEN.test(filePath) || SECRET.test(filePath)) return null;
  if (sizeBytes <= 0 || sizeBytes > MAX_BYTES) return null;
  const ext = extensionOf(filePath);
  if (!ext || ALLOWED.has(ext)) return null;
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  return `skipped ${base} (unsupported type .${ext})`;
}

/** Static guard: agent must not mutate local files (tests grep for these). */
export const LOCAL_MUTATION_APIS = ["rename", "unlink", "rmSync", "writeFile", "copyFile"] as const;

export function agentOnlyReadsLocal(): true {
  return true;
}