/**
 * Painted with the document, before the app stylesheet finishes.
 * Covers the shell skeleton and the standby line so those first frames
 * stay readable while styles.css and ask-ai.css load with media=print.
 */
export const SHELL_CRITICAL_CSS = [
  "html,body{margin:0;background:#f4f6fa;color:#102a43;font-family:Inter,ui-sans-serif,system-ui,sans-serif}",
  "html.dark,html.dark body{background:#0b1b2b;color:#f4f7fb}",
  "[data-shell-paint]{box-sizing:border-box;min-height:100vh;padding:32px 16px;background:#f4f6fa;color:#102a43}",
  "html.dark [data-shell-paint]{background:#0b1b2b;color:#f4f7fb}",
  ".milon-skeleton{display:block;min-height:16px;background:#e7edf5;border-radius:12px}",
  "[data-client-boot]{box-sizing:border-box;min-height:100vh;padding:24px 16px;background:#f4f6fa;color:#102a43}",
  "html.dark [data-client-boot]{background:#0b1b2b;color:#f4f7fb}",
  "[data-client-boot] .owner-lede{margin:0 0 12px;font-size:16px;line-height:1.4}",
].join("");
