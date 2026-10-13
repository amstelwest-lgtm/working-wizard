import { useEffect, useId, useRef, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Maximize2, X } from "lucide-react";
import "./enlarge-sheet.css";

/**
 * Full-viewport view for a chart or table.
 * Radix traps focus and closes on Escape. A history entry lets the phone
 * back button close it too.
 */
export function EnlargeSheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  const token = useId();
  const hintId = useId();
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return;
    window.history.pushState({ milonEnlarge: token }, "");
    let armed = true;
    const onPop = () => {
      armed = false;
      onOpenChangeRef.current(false);
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      const state = window.history.state as { milonEnlarge?: string } | null;
      if (armed && state?.milonEnlarge === token) {
        armed = false;
        window.history.back();
      }
    };
  }, [open, token]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="enlarge-sheet__overlay" />
        <DialogPrimitive.Content
          className="enlarge-sheet"
          aria-describedby={hintId}
        >
          <header className="enlarge-sheet__bar">
            <DialogPrimitive.Title className="enlarge-sheet__title">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="enlarge-sheet__close">
              <X className="h-4 w-4" aria-hidden />
              Close
            </DialogPrimitive.Close>
          </header>
          <p id={hintId} className="enlarge-sheet__turn">
            Turn the phone sideways for a wider view. It already fits this screen.
          </p>
          <div className="enlarge-sheet__body">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function EnlargeButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="enlarge-trigger" aria-label={`Enlarge ${label}`} onClick={onClick}>
      <Maximize2 className="h-3.5 w-3.5" aria-hidden />
      Enlarge
    </button>
  );
}
