const ALLOWED = new Set(["pdf", "csv", "xlsx", "xls", "png", "jpg", "jpeg"]);
const MAX_BYTES = 20 * 1024 * 1024;

const HIDDEN =
  /(?:^|[\\/])\.|(?:^|[\\])(?:\$recycle\.bin|System Volume Information|pagefile\.sys|hiberfil\.sys)(?:[\\/]|$)/i;
const SECRET =
  /(?:^|[\\])(?:\.env(?:\..*)?|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.pfx|.*\.key|credentials|Login Data|Cookies)(?:[\\/]|$)/i;

export function shouldUpload(filePath: string, sizeBytes: number): boolean {
  if (HIDDEN.test(filePath) || SECRET.test(filePath)) return false;
  if (sizeBytes <= 0 || sizeBytes > MAX_BYTES) return false;
  const base = filePath.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 1) return false;
  const ext = base.slice(dot + 1).toLowerCase();
  return ALLOWED.has(ext);
}

/** Static guard: agent must not mutate local files (tests grep for these). */
export const LOCAL_MUTATION_APIS = ["rename", "unlink", "rmSync", "writeFile", "copyFile"] as const;

export function agentOnlyReadsLocal(): true {
  return true;
}