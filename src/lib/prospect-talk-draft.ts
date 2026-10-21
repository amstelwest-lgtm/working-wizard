/** Draft typed before React hydrates. React clears a textarea when it assigns defaultValue. */
export const TALK_DRAFT_STORAGE_KEY = "milon-talk-draft";

/**
 * Remembers the composer text. It does not send, and it does not paint a bubble.
 * The Send button is disabled until hydration, so a click cannot navigate.
 */
export const TALK_DRAFT_BOOT = `(function(){var KEY=${JSON.stringify(TALK_DRAFT_STORAGE_KEY)};document.addEventListener("input",function(e){var area=e.target;if(!area||area.tagName!=="TEXTAREA")return;var form=area.closest&&area.closest("form.talk-composer");if(!form||form.getAttribute("data-talk-live")==="1")return;try{sessionStorage.setItem(KEY,area.value);}catch(err){}},true);})();`;
