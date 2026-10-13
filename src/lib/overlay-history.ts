import { useEffect, useRef } from "react";

/**
 * Push one history entry while an overlay is open.
 * Back (the button or the browser) returns to the page underneath.
 */
export function useOverlayHistory(open: boolean, onClose: () => void): () => void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const owns = useRef(false);

  useEffect(() => {
    if (!open) {
      owns.current = false;
      return;
    }
    if (!window.history.state || !(window.history.state as { milonOverlay?: number }).milonOverlay) {
      window.history.pushState({ milonOverlay: 1 }, "");
    }
    owns.current = true;
    const onPop = () => {
      owns.current = false;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [open]);

  return () => {
    if (owns.current && (window.history.state as { milonOverlay?: number } | null)?.milonOverlay) {
      window.history.back();
      return;
    }
    onCloseRef.current();
  };
}
