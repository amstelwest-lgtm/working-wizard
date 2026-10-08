import { useEffect, useState } from "react";
import { Share2 } from "lucide-react";
import { ShareModal } from "./share-modal";
import { LazyInstallOverlay } from "./lazy-install";
import { useShare } from "@/hooks/use-share";
import { useFabScrollHidden, useMobileFabInset } from "@/hooks/use-fab-scroll";

export function ShareButton() {
  const [mounted, setMounted] = useState(false);
  const [hidden, setHidden] = useState(true);
  const { handleShare, shareOpen, setShareOpen, installOpen, setInstallOpen, appUrl } = useShare();
  const scrolledAway = useFabScrollHidden();

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setHidden(Boolean(standalone));
    setMounted(true);
  }, []);

  useMobileFabInset(mounted && !hidden);

  if (!mounted || hidden) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleShare}
        aria-label="Share Milōn"
        className={`fixed z-50 hidden h-[52px] w-[52px] items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-black/20 transition-[transform,opacity] duration-200 active:scale-95 max-md:flex ${
          scrolledAway ? "pointer-events-none opacity-0" : ""
        }`}
        style={{
          bottom: "max(env(safe-area-inset-bottom), 1.5rem)",
          right: "max(env(safe-area-inset-right), 1.5rem)",
          transform: scrolledAway ? "translateY(160%)" : undefined,
        }}
      >
        <Share2 className="h-5 w-5" />
      </button>

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        onOpenInstall={() => setInstallOpen(true)}
        appUrl={appUrl}
      />

      <LazyInstallOverlay
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        onShareAgain={() => {
          setInstallOpen(false);
          setShareOpen(true);
        }}
      />
    </>
  );
}
