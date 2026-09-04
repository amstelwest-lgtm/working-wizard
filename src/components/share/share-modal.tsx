import { useEffect, useState } from "react";
import { X, Mail, Copy, Check, ChevronRight } from "lucide-react";
import { useResolvedCopyPack } from "@/contexts/market";
import { t } from "@/lib/market";
import { SHARE_TEXT, SHARE_TITLE, shareMessageWithUrl } from "@/lib/share-copy";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenInstall: () => void;
  appUrl: string;
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.595 5.39l-.999 3.648 3.893-1.737zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.149-.669-1.611-.916-2.206-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z" />
    </svg>
  );
}

export function ShareModal({ open, onClose, onOpenInstall, appUrl }: Props) {
  const copyPack = useResolvedCopyPack();
  const emailFirst = copyPack === "us";
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  const message = shareMessageWithUrl(appUrl);
  const waUrl = `https://wa.me/?text=${encodeURIComponent(message)}`;

  const emailSubject = SHARE_TITLE;
  const emailBody = `${SHARE_TEXT.replace(/\n/g, "\r\n")}\r\n\r\n${appUrl}\r\n`;
  const mailUrl = `mailto:?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(emailBody)}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = appUrl;
      ta.setAttribute("readonly", "");
      ta.setAttribute("aria-hidden", "true");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* noop */
      }
      document.body.removeChild(ta);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-[55] flex items-end justify-center md:items-center ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      {/* Overlay */}
      <div
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={onClose}
      />

      {/* Sheet — bottom on mobile, centered card on desktop */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share Milōn"
        className={`relative w-full max-w-sm overflow-y-auto rounded-t-2xl bg-background shadow-2xl transition-transform duration-300 ease-out md:rounded-2xl ${
          open ? "translate-y-0" : "translate-y-full md:translate-y-4 md:opacity-0"
        }`}
        style={{
          maxHeight: "80vh",
          paddingBottom: "max(env(safe-area-inset-bottom), 1rem)",
        }}
      >
        {/* Drag handle (mobile only) */}
        <div className="flex justify-center pt-3 pb-1 md:hidden">
          <span className="block h-1 w-8 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 pt-4 pb-4 md:pt-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-foreground">Share Milōn</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {emailFirst
                ? `Invite your accountant or share with a colleague — ${t("sharePrimary", { copyPack })} first`
                : "Invite your accountant or share with a colleague"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Options */}
        <div className="divide-y divide-border border-y border-border">
          {emailFirst ? (
            <>
              <Row
                iconBg="bg-primary/10"
                iconColor="text-primary"
                Icon={Mail}
                label="Share via Email"
                sublabel="Primary for US — send to someone's inbox"
                onClick={() => {
                  window.location.href = mailUrl;
                }}
              />
              <Row
                iconBg="bg-[#25D366]/10"
                iconColor="text-[#25D366]"
                Icon={WhatsAppIcon}
                label="Share via WhatsApp"
                sublabel="Also available"
                onClick={() => window.open(waUrl, "_blank", "noopener,noreferrer")}
              />
            </>
          ) : (
            <>
              <Row
                iconBg="bg-[#25D366]/10"
                iconColor="text-[#25D366]"
                Icon={WhatsAppIcon}
                label="Share via WhatsApp"
                sublabel="Send a link to a contact"
                onClick={() => window.open(waUrl, "_blank", "noopener,noreferrer")}
              />
              <Row
                iconBg="bg-primary/10"
                iconColor="text-primary"
                Icon={Mail}
                label="Share via Email"
                sublabel="Send to someone's inbox"
                onClick={() => {
                  window.location.href = mailUrl;
                }}
              />
            </>
          )}
          <Row
            iconBg={copied ? "bg-emerald-500/10" : "bg-muted"}
            iconColor={copied ? "text-emerald-500" : "text-foreground"}
            Icon={copied ? Check : Copy}
            label="Copy link"
            sublabel={copied ? "Link copied!" : "Paste it anywhere"}
            onClick={handleCopy}
          />
        </div>

        {/* Install instructions link */}
        <div className="px-6 pt-4 pb-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenInstall();
            }}
            className="inline-flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm text-primary hover:bg-accent"
          >
            <span>How to install this app on your phone</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  Icon,
  iconBg,
  iconColor,
  label,
  sublabel,
  onClick,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  iconBg: string;
  iconColor: string;
  label: string;
  sublabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 px-6 py-4 text-left transition active:bg-accent"
    >
      <span
        className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${iconBg} ${iconColor}`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{sublabel}</span>
      </span>
    </button>
  );
}
