/**
 * "See what's missing" on the accountant Overview.
 *
 * The data-requests panel already sits in the first viewport under the Next
 * Step card, so switching to `?tab=overview` or scrolling the pane does
 * nothing a person can see. The card asks the mounted panel to take focus
 * and show a highlight. If the panel is still loading, the request waits
 * until it subscribes.
 */

type Listener = () => void;

let pending = false;
const listeners = new Set<Listener>();

export function requestRevealDataRequests(): void {
  if (listeners.size === 0) {
    pending = true;
    return;
  }
  pending = false;
  for (const listener of listeners) listener();
}

export function subscribeDataRequestsReveal(listener: Listener): () => void {
  listeners.add(listener);
  if (pending) {
    pending = false;
    listener();
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Drop queued reveals and listeners. Tests only. */
export function resetDataRequestsRevealForTests(): void {
  pending = false;
  listeners.clear();
}

export function revealDataRequestsElement(el: HTMLElement): void {
  el.setAttribute("data-called", "true");
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  el.focus({ preventScroll: true });
}
