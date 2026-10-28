import { useMarketFormat } from "@/contexts/market";
import type { WorkLogRow } from "@/lib/home-work-log";

/** Team progress on accountant client Home: date, who, what, status, next. */
export function HomeProgress({
  rows,
  more = 0,
  loading = false,
  onOpenDraft,
  onOpenDrafts,
  onRetry,
}: {
  rows: readonly WorkLogRow[];
  more?: number;
  loading?: boolean;
  onOpenDraft: (draftId: string) => void;
  onOpenDrafts: () => void;
  onRetry?: (retry: NonNullable<WorkLogRow["retry"]>) => void;
}) {
  const { date } = useMarketFormat();
  if (rows.length === 0) {
    return (
      <p className="home-log__empty" data-home-progress="empty">
        {loading ? "Checking the team's work." : "No agent work on this file yet."}
      </p>
    );
  }
  return (
    <div className="home-log" data-home-progress="">
      <table className="home-log__table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Who</th>
            <th scope="col">Work</th>
            <th scope="col">Status</th>
            <th scope="col">Next</th>
            <th scope="col">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} data-work-state={row.state}>
              <td className="home-log__date">
                {row.at ? <time dateTime={row.at}>{date(row.at)}</time> : "—"}
              </td>
              <td className="home-log__who">{row.who}</td>
              <td className="home-log__what">{row.what}</td>
              <td>
                <span className="home-log__status" data-state={row.state}>
                  {row.status}
                </span>
              </td>
              <td className="home-log__next">{row.next ?? "—"}</td>
              <td className="home-log__link">
                {row.draftId ? (
                  <button
                    type="button"
                    data-open-draft={row.draftId}
                    onClick={() => onOpenDraft(row.draftId!)}
                  >
                    Open draft
                  </button>
                ) : row.retry && onRetry ? (
                  <button type="button" data-handoff-retry onClick={() => onRetry(row.retry!)}>
                    Retry
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="home-log__foot">
        {more > 0 ? <span>{more} earlier</span> : <span />}
        <button type="button" className="home-log__all" onClick={onOpenDrafts}>
          All drafts
        </button>
      </div>
    </div>
  );
}
