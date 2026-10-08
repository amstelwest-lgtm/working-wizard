import type { OverviewCardId } from "@/lib/overview-moves-copy";

/** Jump cards in CoS order. Each one shows a figure already on the page and opens its tab. */
export function OverviewSectionCards({
  cards,
  onOpen,
}: {
  cards: readonly {
    id: OverviewCardId;
    label: string;
    figure: string | null;
    detail?: string | null;
  }[];
  onOpen: (id: OverviewCardId) => void;
}) {
  return (
    <div className="overview-cards" data-overview-cards>
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          className="overview-card"
          data-overview-card={card.id}
          onClick={() => onOpen(card.id)}
        >
          <span className="overview-card__label">{card.label}</span>
          {card.figure ? <span className="overview-card__figure">{card.figure}</span> : null}
          {card.detail ? <span className="overview-card__detail">{card.detail}</span> : null}
        </button>
      ))}
    </div>
  );
}
