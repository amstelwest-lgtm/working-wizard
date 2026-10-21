import { clientListQueriesCell, practiceListScoreText } from "@/lib/practice-client-row";

const skeletonStyle = { display: "inline-block", width: 28, height: 14 } as const;

function FigureSkeleton({ figure }: { figure: string }) {
  return (
    <span
      className="milon-skeleton"
      data-figure={figure}
      style={skeletonStyle}
      aria-hidden="true"
    />
  );
}

/** Health number. A skeleton until the books merge. A dash only when nothing scored. */
export function ClientsListScore({ pending, score }: { pending: boolean; score: number | null }) {
  if (pending) return <FigureSkeleton figure="health" />;
  return (
    <span className="ring-score" data-figure="health">
      {practiceListScoreText(score)}
    </span>
  );
}

export function ClientsListRunway({ pending, value }: { pending: boolean; value: string }) {
  if (pending) return <FigureSkeleton figure="runway" />;
  return (
    <span className="runway-val" data-figure="runway">
      {value}
    </span>
  );
}

/** Zero prints 0. A dash is an unread count, not a finished zero. */
export function ClientsListQueries({ pending, count }: { pending: boolean; count: number | null }) {
  if (pending) return <FigureSkeleton figure="queries" />;
  return <span data-figure="queries">{clientListQueriesCell(count)}</span>;
}

export function ClientsListProfit({ pending, text }: { pending: boolean; text: string }) {
  if (pending) return <FigureSkeleton figure="profit" />;
  return <span data-figure="profit">{text}</span>;
}
