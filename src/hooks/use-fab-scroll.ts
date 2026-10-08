import { useEffect, useState } from "react";

let insetHolders = 0;

/** Marks the document so mobile pages pad for the share + notes stack. */
export function useMobileFabInset(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    insetHolders += 1;
    document.documentElement.dataset.milonFab = "1";
    return () => {
      insetHolders -= 1;
      if (insetHolders <= 0) {
        insetHolders = 0;
        delete document.documentElement.dataset.milonFab;
      }
    };
  }, [active]);
}

const subscribers = new Set<(hidden: boolean) => void>();
let listening = false;
let scrolledAway = false;

function publish(next: boolean) {
  if (next === scrolledAway) return;
  scrolledAway = next;
  subscribers.forEach((fn) => fn(next));
}

function ensureScrollListener() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  const mq = window.matchMedia("(max-width: 767px)");
  let last = window.scrollY;
  let frame = 0;
  const onScroll = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      const y = window.scrollY;
      if (!mq.matches) {
        publish(false);
        last = y;
        return;
      }
      const delta = y - last;
      if (y < 12) publish(false);
      else if (delta > 8) publish(true);
      else if (delta < -8) publish(false);
      last = y;
    });
  };
  const onMode = () => {
    if (!mq.matches) publish(false);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  mq.addEventListener("change", onMode);
}

/**
 * On a phone, slide the floating buttons off screen while the page moves
 * down, and bring them back on scroll-up. They keep the same actions.
 * One listener serves every button.
 */
export function useFabScrollHidden(): boolean {
  const [hidden, setHidden] = useState(scrolledAway);
  useEffect(() => {
    ensureScrollListener();
    subscribers.add(setHidden);
    setHidden(scrolledAway);
    return () => {
      subscribers.delete(setHidden);
    };
  }, []);
  return hidden;
}
