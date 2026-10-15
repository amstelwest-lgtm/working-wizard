const MARKER = "@@milon-projection@@";
const CLOSER = "@@/milon-projection@@";

/**
 * Action copy sometimes stores a machine token plus a JSON blob, closed by
 * @@/milon-projection@@. The plan, PDF, email, and chat show the sentence
 * around it. The token is not part of the sentence.
 */
export function stripMilonProjection(text: string | null | undefined): string {
  const raw = text ?? "";
  if (!raw.includes(MARKER) && !raw.includes(CLOSER)) return raw;
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const at = raw.indexOf(MARKER, i);
    if (at < 0) {
      out += raw.slice(i).split(CLOSER).join("");
      break;
    }
    out += raw.slice(i, at);
    let j = at + MARKER.length;
    while (j < raw.length && /\s/.test(raw[j]!)) j += 1;
    if (raw[j] === "{") {
      let depth = 0;
      let inString = false;
      let escape = false;
      for (; j < raw.length; j += 1) {
        const ch = raw[j];
        if (inString) {
          if (escape) escape = false;
          else if (ch === "\\") escape = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            j += 1;
            break;
          }
        }
      }
    }
    while (j < raw.length && /\s/.test(raw[j]!)) j += 1;
    if (raw.startsWith(CLOSER, j)) j += CLOSER.length;
    i = j;
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim();
}
