import { createFileRoute } from "@tanstack/react-router";
import { ClientAgentLinkPage } from "@/components/client-agent-link-page";

/** Public client link. No login. The token is hashed before it is looked up. */
export const Route = createFileRoute("/a/$token")({
  component: AgentLinkRoute,
  head: () => ({ meta: [{ title: "Tax Specialist — Milōn" }] }),
});

function AgentLinkRoute() {
  const { token } = Route.useParams();
  return <ClientAgentLinkPage token={token} />;
}
