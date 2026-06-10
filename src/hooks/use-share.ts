import { useState, useEffect } from "react";

function resolveAppUrl(): string {
  const fromEnv = import.meta.env.VITE_APP_URL as string | undefined;
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
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
      title: options?.title ?? "Milōn — Financial Intelligence for SMEs",
      text:
        options?.text ??
        "Track your business financial health with 31 ratios across Profit, Assets, Financing and Cash.",
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
