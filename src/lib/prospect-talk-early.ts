/**
 * Sends that happen before React hydrates. The boot script is inlined in
 * the document head. It does not wait for the bundle, and it does not post.
 */

export const TALK_EARLY_STORAGE_KEY = "milon-talk-early";
export const TALK_DRAFT_STORAGE_KEY = "milon-talk-draft";

type EarlyWindow = Window & { __milonTalkEarly?: unknown };

const claimed: { texts: string[] | null } = { texts: null };
const postedEarly = new Set<string>();

function readStoredEarly(): string[] {
  if (typeof window === "undefined") return [];
  const win = window as EarlyWindow;
  const mem = Array.isArray(win.__milonTalkEarly)
    ? win.__milonTalkEarly.filter((item): item is string => typeof item === "string")
    : [];
  let stored: string[] = [];
  try {
    const raw = window.sessionStorage.getItem(TALK_EARLY_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(parsed)) {
      stored = parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    stored = [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const text of [...stored, ...mem]) {
    const trimmed = text.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** Texts captured before hydration. Stable across a strict remount. */
export function claimEarlyTalkSends(): string[] {
  if (claimed.texts) return claimed.texts;
  claimed.texts = readStoredEarly();
  return claimed.texts;
}

/**
 * Early texts post once. A message queued by React after hydration is not
 * in that set and always posts.
 */
export function shouldDeliverQueued(text: string): boolean {
  if (!claimed.texts?.includes(text)) return true;
  if (postedEarly.has(text)) return false;
  postedEarly.add(text);
  return true;
}

/** Drop the reload copy. The in-memory claim stays so a remount can paint. */
export function clearEarlyStorage(): void {
  if (typeof window === "undefined") return;
  const win = window as EarlyWindow;
  win.__milonTalkEarly = [];
  try {
    window.sessionStorage.removeItem(TALK_EARLY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Inline head script. Keep the keys in step with the constants above. */
export const TALK_EARLY_BOOT = `(function(){
  var KEY = ${JSON.stringify(TALK_EARLY_STORAGE_KEY)};
  var DRAFT = ${JSON.stringify(TALK_DRAFT_STORAGE_KEY)};
  function texts() {
    var mem = window.__milonTalkEarly;
    if (!Array.isArray(mem)) mem = [];
    var stored = [];
    try { stored = JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch (e) { stored = []; }
    if (!Array.isArray(stored)) stored = [];
    var seen = {};
    var out = [];
    var all = stored.concat(mem);
    for (var i = 0; i < all.length; i++) {
      var text = String(all[i] || "").trim();
      if (!text || seen[text]) continue;
      seen[text] = 1;
      out.push(text);
    }
    return out;
  }
  function remember(text) {
    var next = texts();
    if (next.indexOf(text) === -1) next.push(text);
    window.__milonTalkEarly = next;
    try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch (e) {}
    try { sessionStorage.removeItem(DRAFT); } catch (e2) {}
  }
  function paint(text) {
    var host = document.getElementById("talk-early-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "talk-early-host";
      host.style.cssText = "position:fixed;left:16px;right:16px;bottom:96px;z-index:20;";
      document.documentElement.appendChild(host);
    }
    var bubble = document.createElement("div");
    bubble.className = "talk-bubble talk-bubble-you";
    bubble.setAttribute("data-talk-early", "1");
    var who = document.createElement("span");
    who.className = "talk-who";
    who.textContent = "You";
    var body = document.createElement("p");
    body.textContent = text;
    bubble.appendChild(who);
    bubble.appendChild(body);
    host.appendChild(bubble);
  }
  function capture(form) {
    if (!form || !form.classList || !form.classList.contains("talk-composer")) return;
    if (form.getAttribute("data-talk-live") === "1") return;
    var area = form.querySelector("textarea");
    var text = area && area.value ? String(area.value).trim() : "";
    if (!text) return;
    if (area) area.value = "";
    remember(text);
    paint(text);
  }
  document.addEventListener("click", function (event) {
    var node = event.target;
    if (!node || !node.closest) return;
    var button = node.closest(".talk-send");
    if (!button) return;
    var form = button.closest("form");
    if (!form || form.getAttribute("data-talk-live") === "1") return;
    event.preventDefault();
    event.stopPropagation();
    capture(form);
  }, true);
  document.addEventListener("submit", function (event) {
    var form = event.target;
    if (!form || !form.classList || !form.classList.contains("talk-composer")) return;
    if (form.getAttribute("data-talk-live") === "1") return;
    event.preventDefault();
    event.stopPropagation();
    capture(form);
  }, true);
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    var area = event.target;
    if (!area || area.tagName !== "TEXTAREA") return;
    var form = area.closest && area.closest("form.talk-composer");
    if (!form || form.getAttribute("data-talk-live") === "1") return;
    event.preventDefault();
    event.stopPropagation();
    capture(form);
  }, true);
  document.addEventListener("input", function (event) {
    var area = event.target;
    if (!area || area.tagName !== "TEXTAREA") return;
    var form = area.closest && area.closest("form.talk-composer");
    if (!form || form.getAttribute("data-talk-live") === "1") return;
    try { sessionStorage.setItem(DRAFT, area.value); } catch (e) {}
  }, true);
  document.addEventListener("DOMContentLoaded", function () {
    if (document.querySelector("[data-talk-early]")) return;
    var pending = texts();
    for (var i = 0; i < pending.length; i++) paint(pending[i]);
  });
})();`;
