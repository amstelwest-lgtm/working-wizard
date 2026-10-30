import { Link } from "@tanstack/react-router";
import type { AgentWorkItem } from "@/lib/agent-work";

/** The work behind an open agent. Every row is a link. No skeletons.
 *  Without a label it sits inside an AgentSection, which owns the heading. */
export function AgentWork({
  label,
  items,
  empty,
}: {
  label?: string;
  items: readonly AgentWorkItem[];
  empty?: string;
}) {
  return (
    <div
      className="agent-work"
      role={label ? "region" : undefined}
      aria-label={label}
      data-agent-work="true"
    >
      {label ? <p className="agent-work-kicker">{label}</p> : null}
      {items.length === 0 ? (
        <p className="agent-work-empty">{empty || "Nothing waiting."}</p>
      ) : (
        <ul className="agent-work-list">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to={item.link.to}
                params={item.link.params as never}
                hash={item.link.hash}
                search={item.link.search as never}
                className="agent-work-link"
                data-agent-work-link={item.id}
              >
                <span className="agent-work-title">{item.title}</span>
                <span className="agent-work-detail">{item.detail}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
