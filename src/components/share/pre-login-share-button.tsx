import { Share2 } from "lucide-react";
import { ShareModal } from "./share-modal";
import { InstallInstructions } from "./install-instructions";
import { useShare } from "@/hooks/use-share";

export function PreLoginShareButton() {
  const { handleShare, shareOpen, setShareOpen, installOpen, setInstallOpen, appUrl } = useShare({
    title: "Milōn — Financial Intelligence for SMEs",
    text: "Check out Milōn — a financial intelligence platform for SMEs and their accountants. Track business health, get specific actions to improve it.",
  });

  return (
    <>
      <button
        type="button"
        onClick={handleShare}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <Share2 className="h-3.5 w-3.5 shrink-0" />
        Tell a colleague
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
