import { createFileRoute } from "@tanstack/react-router";
import { ClientAgentLinkPage } from "@/components/client-agent-link-page";
import { SEND_LINK_META } from "@/lib/client-agent-link";

/** Public client link. No login. The token is hashed before it is looked up. */
export const Route = createFileRoute("/a/$token")({
  component: AgentLinkRoute,
  head: () => ({
    meta: SEND_LINK_META.map((entry) =>
      "title" in entry ? { title: entry.title } : { name: entry.name, content: entry.content },
    ),
  }),
});

function AgentLinkRoute() {
  const { token } = Route.useParams();
  return <ClientAgentLinkPage token={token} />;
}
