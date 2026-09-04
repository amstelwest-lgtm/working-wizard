import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MarketPicker } from "@/components/market-picker";
import { draftToSelection, isDraftComplete, type DraftMarket } from "@/lib/market";

export function MarketGate({
  onSave,
  saving,
}: {
  onSave: (draft: DraftMarket) => Promise<void>;
  saving?: boolean;
}) {
  const [draft, setDraft] = useState<DraftMarket>({ country: null, regionCode: null });
  const [busy, setBusy] = useState(false);
  const complete = isDraftComplete(draft);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 px-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <p className="text-[10px] uppercase tracking-[0.16em] text-[#d4a550]">First step</p>
        <h2 className="mt-2 text-lg font-semibold text-slate-50">
          Where does this business operate?
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          This sets currency, dates, and tax. South Africa stays on rand and VAT. The United States
          needs a state so sales tax is not guessed.
        </p>
        <div className="mt-5">
          <MarketPicker value={draft} onChange={setDraft} />
        </div>
        <Button
          className="mt-5 w-full bg-[#d4a550] text-slate-950 hover:bg-[#e0b45c]"
          disabled={!complete || busy || saving}
          onClick={async () => {
            const sel = draftToSelection(draft);
            if (!sel) {
              toast.error("Pick a country — and a US state if you chose the United States.");
              return;
            }
            setBusy(true);
            try {
              await onSave(draft);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not save region");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy || saving ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
