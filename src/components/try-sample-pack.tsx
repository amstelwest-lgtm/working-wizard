/**
 * SAMPLE advisory pack on the public demo. Rendered from the board already
 * on the page. No export, no ledger, no saved pack.
 */
import { buildSampleAdvisoryPack } from "@/lib/trial-sample-pack";
import type { TrialBoard } from "@/lib/trial-demo";

export function TrySamplePack({ board }: { board: TrialBoard }) {
  const pack = buildSampleAdvisoryPack(board);
  return (
    <article className="try-pack" aria-label="Sample advisory pack">
      <p className="try-chat-board-caption">
        <span className="try-stamp">{pack.stamp}</span>
        <span className="try-chat-board-who">
          <span>Milōn</span> Advisor
        </span>
        {pack.title}
      </p>
      <h3 className="try-pack-client">{pack.clientName}</h3>
      {pack.sections.map((section) => (
        <section key={section.title} className="try-pack-section">
          <h4>{section.title}</h4>
          <p>{section.body}</p>
          {section.bullets && section.bullets.length > 0 ? (
            <ul>
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </article>
  );
}
