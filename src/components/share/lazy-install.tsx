import { lazy, Suspense } from "react";

const InstallInstructions = lazy(() =>
  import("./install-instructions").then((mod) => ({ default: mod.InstallInstructions })),
);

/** PWA instructions load only after the visitor asks to install. Hidden = unmounted. */
export function LazyInstallOverlay({
  open,
  onClose,
  onShareAgain,
}: {
  open: boolean;
  onClose: () => void;
  onShareAgain: () => void;
}) {
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <InstallInstructions open onClose={onClose} onShareAgain={onShareAgain} />
    </Suspense>
  );
}
