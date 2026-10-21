/** Draft typed before React hydrates. React clears a textarea when it assigns defaultValue. */
export const TALK_DRAFT_STORAGE_KEY = "milon-talk-draft";

/**
 * Remembers the composer text before and after hydration. It does not send,
 * and it does not paint a bubble. A remount reads the saved value back into
 * the empty textarea. The Send button is disabled until hydration, so a
 * click cannot navigate.
 */
export const TALK_DRAFT_BOOT = `(function(){var KEY=${JSON.stringify(TALK_DRAFT_STORAGE_KEY)};document.addEventListener("input",function(e){var area=e.target;if(!area||area.tagName!=="TEXTAREA")return;var form=area.closest&&area.closest("form.talk-composer");if(!form)return;try{if(area.value)sessionStorage.setItem(KEY,area.value);else sessionStorage.removeItem(KEY);}catch(err){}},true);})();`;
