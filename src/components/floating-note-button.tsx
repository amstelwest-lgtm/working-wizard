import { PenLine, X } from "lucide-react";
import { toast } from "sonner";
import { useNotes } from "@/contexts/notes";

export function FloatingNoteButton() {
  const { pinMode, setPinMode, surface } = useNotes();

  return (
    <button
      onClick={() => {
        if (!surface?.clientId) {
          toast.message("Open a client workspace to pin notes");
          return;
        }
        setPinMode(!pinMode);
      }}
      title={
        !surface?.clientId
          ? "Open a client to pin notes"
          : pinMode
            ? "Cancel pin mode"
            : "Pin a note on this page"
      }
      className={`fixed bottom-20 right-4 z-50 flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-all duration-200 ${
        !surface?.clientId
          ? "border-slate-400/20 bg-slate-500/10 text-slate-400/50"
          : pinMode
            ? "border-[#d4a550] bg-[#d4a550]/25 text-[#d4a550] shadow-[0_0_12px_rgba(212,165,80,0.4)]"
            : "border-[#d4a550]/25 bg-[#d4a550]/12 text-[#d4a550]/60 hover:border-[#d4a550]/60 hover:bg-[#d4a550]/25 hover:text-[#d4a550]"
      }`}
    >
      {pinMode ? <X className="h-4 w-4" /> : <PenLine className="h-4 w-4" />}
    </button>
  );
}
