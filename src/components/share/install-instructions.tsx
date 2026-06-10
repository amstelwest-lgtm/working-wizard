import { useState } from "react";
import {
  ArrowLeft,
  Globe,
  Share as ShareIos,
  PlusSquare,
  Check,
  Chrome,
  MoreVertical,
  Smartphone,
  Info,
  Share2,
} from "lucide-react";

interface Step {
  Icon: React.ComponentType<{ className?: string }>;
  instruction: string;
  explanation: string;
}

const IOS_STEPS: Step[] = [
  {
    Icon: Globe,
    instruction: "Open in Safari",
    explanation: "Make sure you're viewing this page in Safari, not Chrome or another browser.",
  },
  {
    Icon: ShareIos,
    instruction: "Tap the Share button",
    explanation: "Find it at the bottom of your screen in the Safari toolbar.",
  },
  {
    Icon: PlusSquare,
    instruction: "Tap 'Add to Home Screen'",
    explanation: "Scroll down in the share menu until you see this option.",
  },
  {
    Icon: Check,
    instruction: "Tap 'Add'",
    explanation: "Milōn will appear on your home screen like any other app.",
  },
];

const ANDROID_STEPS: Step[] = [
  {
    Icon: Chrome,
    instruction: "Open in Chrome",
    explanation: "Make sure you're using Chrome browser.",
  },
  {
    Icon: MoreVertical,
    instruction: "Tap the menu button",
    explanation: "Find the three dots in the top right corner of Chrome.",
  },
  {
    Icon: Smartphone,
    instruction: "Tap 'Add to Home screen'",
    explanation: "You may also see 'Install app' depending on your Android version.",
  },
  {
    Icon: Check,
    instruction: "Tap 'Add'",
    explanation: "Milōn will appear on your home screen and in your app drawer.",
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
  onShareAgain: () => void;
}

export function InstallInstructions({ open, onClose, onShareAgain }: Props) {
  const [tab, setTab] = useState<"ios" | "android">("ios");
  const steps = tab === "ios" ? IOS_STEPS : ANDROID_STEPS;

  return (
    <div
      className={`fixed inset-0 z-[60] bg-background transition-transform duration-300 ease-out md:hidden ${
        open ? "translate-x-0" : "translate-x-full pointer-events-none"
      }`}
      aria-hidden={!open}
    >
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-3">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="-ml-2 inline-flex h-9 w-9 items-center justify-center rounded-full text-foreground hover:bg-accent"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-tight text-foreground">
              Add to your home screen
            </h2>
            <p className="text-xs text-muted-foreground">
              Use Milōn like a native app — no app store needed
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-border px-4">
          <div className="flex gap-1">
            <TabButton active={tab === "ios"} onClick={() => setTab("ios")}>
              iPhone / Safari
            </TabButton>
            <TabButton active={tab === "android"} onClick={() => setTab("android")}>
              Android / Chrome
            </TabButton>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-5">
          <ol className="space-y-4">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-border bg-muted text-foreground">
                    <s.Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-sm font-semibold text-foreground">{s.instruction}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                      {s.explanation}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {/* Info box */}
          <div className="mt-6 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Milōn works offline once installed. Your data syncs automatically when you reconnect.
            </p>
          </div>

          {/* Share again */}
          <div className="mt-6 text-center">
            <p className="text-xs text-muted-foreground">Know someone who could use this?</p>
            <button
              type="button"
              onClick={() => {
                onClose();
                onShareAgain();
              }}
              className="mt-2 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Share2 className="h-4 w-4" />
              Share Milōn
            </button>
          </div>

          <div className="h-[max(env(safe-area-inset-bottom),1rem)]" />
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-3 py-2.5 text-sm font-medium transition ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
      {active && (
        <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary" />
      )}
    </button>
  );
}
