import type { OwnerReplyBlock, OwnerReplyModel, TextRun } from "@/lib/owner-reply-format";

function Runs({ runs }: { runs: TextRun[] }) {
  return runs.map((run, index) =>
    run.bold ? <strong key={index}>{run.text}</strong> : <span key={index}>{run.text}</span>,
  );
}

function Block({ block }: { block: OwnerReplyBlock }) {
  if (block.type === "ul") {
    return (
      <ul className="owner-reply-list">
        {block.items.map((item, index) => (
          <li key={index}>
            <Runs runs={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (block.type === "ol") {
    return (
      <ol className="owner-reply-list">
        {block.items.map((item, index) => (
          <li key={index}>
            <Runs runs={item} />
          </li>
        ))}
      </ol>
    );
  }
  return (
    <p className="owner-reply-copy">
      <Runs runs={block.runs} />
    </p>
  );
}

export function OwnerReply({ model }: { model: OwnerReplyModel }) {
  return (
    <div className="owner-reply" data-owner-reply="true">
      {model.headline.length ? (
        <p className="owner-reply-headline">
          <Runs runs={model.headline} />
        </p>
      ) : null}
      {model.stats.length ? (
        <ul className="owner-reply-stats">
          {model.stats.map((stat) => (
            <li key={stat.label} className="owner-reply-stat">
              <span className="owner-reply-stat-label">{stat.label}</span>
              <span className="owner-reply-stat-value">
                <Runs runs={stat.value} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {model.body.map((block, index) => (
        <Block key={index} block={block} />
      ))}
      {model.actions.length ? (
        <div className="owner-reply-next">
          <p className="owner-reply-kicker">Next actions</p>
          <ol className="owner-reply-actions">
            {model.actions.map((item, index) => (
              <li key={index}>
                <Runs runs={item} />
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
