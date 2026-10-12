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
        className={`share-fab fixed right-6 z-50 hidden h-[52px] w-[52px] items-center justify-center rounded-full bg-[#0B5FFF] text-white shadow-lg shadow-[#0B5FFF]/25 transition-[transform,opacity] duration-200 active:scale-95 max-md:left-4 max-md:right-auto max-md:flex ${
          scrolledAway ? "pointer-events-none opacity-0" : ""
        }`}
        style={{
          bottom: "max(env(safe-area-inset-bottom), 1rem)",
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
