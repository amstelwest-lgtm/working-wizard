import { Share2 } from "lucide-react";
import { ShareModal } from "./share-modal";
import { InstallInstructions } from "./install-instructions";
import { useShare } from "@/hooks/use-share";

export function HeaderShareButton() {
  const { handleShare, shareOpen, setShareOpen, installOpen, setInstallOpen, appUrl } = useShare({
    title: "Milōn — Financial Intelligence for SMEs",
    text: "I use Milōn to track my business financial health. 31 ratios across Profit, Assets, Financing and Cash — with specific steps to improve each one.",
  });

  return (
    <>
      <button
        type="button"
        onClick={handleShare}
        title="Share Milōn"
        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50/80 px-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-600 transition-colors hover:border-[#b7872a]/50 hover:bg-[#d4a550]/10 dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-400 dark:hover:border-[#b7872a]/60 dark:hover:text-[#d4a550]"
      >
        <Share2 className="h-3 w-3 shrink-0" />
        <span className="hidden sm:inline">Share</span>
      </button>

      <ShareModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        onOpenInstall={() => setInstallOpen(true)}
        appUrl={appUrl}
      />

      <InstallInstructions
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
