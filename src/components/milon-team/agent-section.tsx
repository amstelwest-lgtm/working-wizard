import { useId, type ReactNode } from "react";
import { AGENT_SECTION_COPY, type AgentSectionKey } from "@/lib/agent-section-copy";

/** One section on an agent page: a title, one muted purpose sentence, then the content. */
export function AgentSection({
  section,
  children,
  className,
  ...rest
}: {
  section: AgentSectionKey;
  children: ReactNode;
  className?: string;
} & Record<`data-${string}`, string | undefined>) {
  const id = useId();
  const copy = AGENT_SECTION_COPY[section];
  return (
    <section
      className={className ? `agent-section ${className}` : "agent-section"}
      aria-labelledby={id}
      data-agent-section={section}
      {...rest}
    >
      <h2 className="agent-section-title" id={id}>
        {copy.title}
      </h2>
      <p className="agent-section-purpose">{copy.purpose}</p>
      {children}
    </section>
  );
}
