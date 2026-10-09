import { useEffect, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { AccountantProfileProvider } from "@/contexts/accountant-profile";
import { ViewModeProvider } from "@/contexts/view-mode";
import { ShareButton } from "@/components/share";
import { AnalyticsProvider } from "@/contexts/analytics";
import { NotesProvider } from "@/contexts/notes";
import { FloatingNoteButton } from "@/components/floating-note-button";
import { NoteArchiveSheet } from "@/components/note-archive";

function LandingFloatGate() {
  const { user } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const onLanding = pathname === "/" || pathname === "";
  const [narrow, setNarrow] = useState(true);
  const [measured, setMeasured] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    setMeasured(true);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Logged-out `/` below 1024px: no pencil or share button in the DOM.
  // Until the viewport is measured, render neither so a phone never hydrates them.
  if (onLanding && !user && (!measured || narrow)) return null;
  if (onLanding && !user) return <FloatingNoteButton safeCorner />;

  return (
    <>
      <ShareButton />
      <FloatingNoteButton />
    </>
  );
}

function ChromeProviders({ children }: { children: ReactNode }) {
  return (
    <AccountantProfileProvider>
      <AnalyticsProvider>
        <NotesProvider>
          <ViewModeProvider>{children}</ViewModeProvider>
        </NotesProvider>
      </AnalyticsProvider>
    </AccountantProfileProvider>
  );
}

/** Authenticated shell. Loaded only off the public marketing routes. */
export function AppChrome({ children }: { children: ReactNode }) {
  return (
    <ChromeProviders>
      {children}
      <LandingFloatGate />
      <NoteArchiveSheet />
      <Toaster position="top-right" richColors offset={16} style={{ zIndex: 70 }} />
    </ChromeProviders>
  );
}

/** Pencil, share, and toasts for public pages. Not part of the landing entry. */
export function PublicChrome() {
  return (
    <ChromeProviders>
      <LandingFloatGate />
      <NoteArchiveSheet />
      <Toaster position="top-right" richColors offset={16} style={{ zIndex: 70 }} />
    </ChromeProviders>
  );
}
