const MARKER = "@@milon-projection@@";

/**
 * Action copy sometimes stores a machine token plus a JSON blob.
 * The plan shows the sentence around it. The token is not part of the sentence.
 */
export function stripMilonProjection(text: string | null | undefined): string {
  const raw = text ?? "";
  if (!raw.includes(MARKER)) return raw;
  let out = "";
  let i = 0;
  while (i < raw.length) {
    const at = raw.indexOf(MARKER, i);
    if (at < 0) {
      out += raw.slice(i);
      break;
    }
    out += raw.slice(i, at);
    let j = at + MARKER.length;
    while (j < raw.length && /\s/.test(raw[j]!)) j += 1;
    if (raw[j] === "{") {
      let depth = 0;
      for (; j < raw.length; j += 1) {
        const ch = raw[j];
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
    i = j;
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim();
}
