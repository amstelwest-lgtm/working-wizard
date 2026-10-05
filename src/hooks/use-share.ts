import { useState, useEffect } from "react";
import { appRedirectOrigin } from "@/lib/app-origin";
import { SHARE_TEXT, SHARE_TITLE } from "@/lib/share-copy";

function resolveAppUrl(): string {
  const fromEnv = import.meta.env.VITE_APP_URL as string | undefined;
  const fromWindow = typeof window !== "undefined" ? window.location.origin : null;
  return appRedirectOrigin([fromWindow, fromEnv]);
}

interface UseShareOptions {
  title?: string;
  text?: string;
}

export function useShare(options?: UseShareOptions) {
  const [shareOpen, setShareOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [appUrl, setAppUrl] = useState("");

  useEffect(() => {
    setAppUrl(resolveAppUrl());
  }, []);

  const handleShare = async () => {
    const shareData = {
      title: options?.title ?? SHARE_TITLE,
      text: options?.text ?? SHARE_TEXT,
      url: appUrl || resolveAppUrl(),
    };

    if (
      typeof navigator !== "undefined" &&
      typeof navigator.share === "function" &&
      (typeof navigator.canShare !== "function" || navigator.canShare(shareData))
    ) {
      try {
        await navigator.share(shareData);
        return;
      } catch (err) {
        const e = err as { name?: string };
        if (e?.name === "AbortError") return;
      }
    }
    setShareOpen(true);
  };

  return {
    handleShare,
    shareOpen,
    setShareOpen,
    installOpen,
    setInstallOpen,
    appUrl,
  };
}
