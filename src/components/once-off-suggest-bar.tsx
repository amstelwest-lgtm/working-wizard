/**
 * Suggest once-offs from bank history, then Save writes them.
 * Suggest itself does not persist and does not move the forecast timestamp.
 */
import { Button } from "@/components/ui/button";

export function OnceOffSuggestBar({
  showSuggest,
  needsSave,
  saving,
  status,
  staged,
  onSuggest,
  onSave,
}: {
  showSuggest: boolean;
  needsSave: boolean;
  saving: boolean;
  status: string;
  staged: readonly { id: string; name: string; amountLabel: string }[];
  onSuggest: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3" data-once-off-save="true">
      {showSuggest ? (
        <Button type="button" variant="outline" onClick={onSuggest}>
          Suggest once-offs
        </Button>
      ) : null}
      <Button type="button" variant="outline" disabled={!needsSave || saving} onClick={onSave}>
        Save once-off rows
      </Button>
      <span role="status" className="text-sm text-slate-600 dark:text-slate-300">
        {saving ? "Saving…" : needsSave ? "Once-off rows are not saved yet." : status}
      </span>
      {staged.length ? (
        <ul className="w-full space-y-1 text-sm" data-suggested-once-offs="true">
          {staged.map((line) => (
            <li key={line.id}>
              {line.name} {line.amountLabel} · once-off · suggested – confirm
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
