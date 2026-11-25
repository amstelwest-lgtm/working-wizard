/**
 * Text for an agent composer opened from a link.
 * The string is plain text. Nothing here sends it.
 */

export const COMPOSER_PROMPT_MAX = 500;

/** Decode one layer of percent-encoding, trim, and cap. Markup stays characters. */
export function composerPromptText(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0) return "";
  let text = raw;
  if (/%[0-9A-Fa-f]{2}/.test(text)) {
    try {
      text = decodeURIComponent(text.replace(/\+/g, " "));
    } catch {
      text = raw;
    }
  }
  text = text.replace(/[\u0000-\u001f\u007f]/g, "");
  return text.trim().slice(0, COMPOSER_PROMPT_MAX);
}

/** The box can show this text. `send` is always false: the accountant sends. */
export function composerPromptPrefill(raw: string | null | undefined): {
  text: string;
  send: false;
} {
  return { text: composerPromptText(raw), send: false };
}
