/**
 * Double-click a period figure, then Confirm. Nothing is written before that.
 * Same two decisions as a Financial Manager proposal: Confirm and apply, or Reject.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { parseEditableAmount } from "@/lib/cash-week-overrides";
import { saveConfirmedWaterfallPatch, type FigureEditDraft } from "@/lib/figure-edit";
import { figureDeltaLines } from "@/lib/figure-proposal";

const FigureEditContext = createContext<((draft: FigureEditDraft) => void) | null>(null);

export function FigureEditProvider({
  onPropose,
  children,
}: {
  onPropose: (draft: FigureEditDraft) => void;
  children: ReactNode;
}) {
  return <FigureEditContext.Provider value={onPropose}>{children}</FigureEditContext.Provider>;
}

export function useFigureEdit(): ((draft: FigureEditDraft) => void) | null {
  return useContext(FigureEditContext);
}

export function useManualFigureEdit(input: {
  clientId?: string;
  onApplied?: (financials: Record<string, unknown>) => void;
}) {
  const [pending, setPending] = useState<FigureEditDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const onApplied = input.onApplied;

  const propose = useCallback((draft: FigureEditDraft) => {
    if (!Number.isFinite(draft.after) || Math.abs(draft.after - draft.before) < 0.005) {
      setPending(null);
      return;
    }
    setPending(draft);
  }, []);

  const reject = useCallback(() => {
    setPending(null);
  }, []);

  const confirm = useCallback(async () => {
    if (!pending || busy) return;
    if (!input.clientId) {
      toast.error("Open a client file before saving this figure.");
      return;
    }
    setBusy(true);
    const result = await saveConfirmedWaterfallPatch(input.clientId, {
      [pending.key]: pending.after,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(
        result.reason === "confirm_required"
          ? "Confirm the change before it is saved."
          : result.reason,
      );
      return;
    }
    setPending(null);
    onApplied?.(result.financials);
    toast.success("Saved. The change is on file.");
  }, [busy, input.clientId, onApplied, pending]);

  return { pending, busy, propose, confirm, reject };
}

export function FigureEditConfirm({
  pending,
  busy,
  onConfirm,
  onReject,
}: {
  pending: FigureEditDraft | null;
  busy: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  if (!pending) return null;
  const lines = figureDeltaLines({
    surface: "waterfall",
    patch: { [pending.key]: pending.after },
    beforeValues: { [pending.key]: pending.before },
  });
  return (
    <section
      className="mb-3 rounded-xl border border-[#DBEAFE] bg-white p-3 text-[#102A43] dark:border-[#1e3a5f] dark:bg-[#0B1B2B] dark:text-[#F4F7FB]"
      data-figure-edit-confirm=""
      aria-label="Profit change waiting for you"
    >
      <h3 className="text-xs font-bold uppercase tracking-[0.16em]">
        Profit change waiting for you
      </h3>
      <p className="mt-2 text-sm">Nothing is saved until you confirm.</p>
      {lines.length ? (
        <ul className="mt-2 space-y-1 text-sm">
          {lines.map((line) => (
            <li key={line.key}>{line.text}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={onConfirm}>
          Confirm and apply
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onReject}>
          Reject
        </Button>
      </div>
    </section>
  );
}

export function FigureAmountButton({
  label,
  field,
  amount,
  display,
  className,
  style,
  dataNeg,
  onPropose,
}: {
  label: string;
  field: FigureEditDraft["key"];
  amount: number;
  display: string;
  className?: string;
  style?: CSSProperties;
  dataNeg?: boolean;
  onPropose: (draft: FigureEditDraft) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = parseEditableAmount(draft);
    if (next == null) return;
    onPropose({ key: field, label, before: amount, after: next });
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setEditing(false);
          }
        }}
        onClick={(event) => event.stopPropagation()}
        inputMode="decimal"
        aria-label={`Edit ${label}`}
        className="w-[5.5rem] border-0 border-b border-[#0B5FFF] bg-transparent p-0 text-right text-inherit tabular-nums outline-none"
        style={style}
      />
    );
  }

  return (
    <button
      type="button"
      title="Double-click to edit"
      data-figure-edit={field}
      data-neg={dataNeg ? "true" : undefined}
      className={`cursor-text border-0 bg-transparent p-0 text-inherit ${className ?? ""}`}
      style={style}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDraft(String(Math.round(amount * 100) / 100));
        setEditing(true);
      }}
    >
      {display}
    </button>
  );
}
