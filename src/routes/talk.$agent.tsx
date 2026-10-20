import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ProspectTalkLive } from "@/components/prospect-talk";
import { readMarketingVisitor } from "@/lib/geo-country.functions";
import type { ProspectAgentCopy } from "@/lib/prospect-talk";
import { TALK_EARLY_BOOT } from "@/lib/prospect-talk-early";
import { bookTrialCall } from "@/lib/trial-followup.functions";
import tryCss from "../styles/try.css?inline";
import talkCss from "../styles/prospect-talk.css?inline";

export const Route = createFileRoute("/talk/$agent")({
  loader: async () => {
    const visitor = await readMarketingVisitor();
    if (visitor.copyPack !== "za") return { copyPack: visitor.copyPack, taxAgent: null };
    const { TAX_TALK } = await import("@/lib/prospect-tax-copy");
    const taxAgent: ProspectAgentCopy = {
      slug: TAX_TALK.slug,
      face: TAX_TALK.face,
      role: TAX_TALK.role,
      greeting: TAX_TALK.greeting,
      questions: TAX_TALK.questions,
    };
    return { copyPack: "za" as const, taxAgent };
  },
  component: TalkRoute,
  head: () => ({
    meta: [
      { title: "Talk to an agent — Milōn" },
      {
        name: "description",
        content: "One Milōn agent, a labelled sample, and no account.",
      },
      { name: "robots", content: "noindex" },
      { name: "theme-color", content: "#ffffff" },
    ],
    styles: [{ children: `${talkCss}\n${tryCss}` }],
    scripts: [
      {
        children: `(function(){try{var d=document.documentElement;d.classList.remove("dark");d.setAttribute("data-theme","light");d.style.backgroundColor="#ffffff";d.style.color="#102a43";}catch(e){}})();${TALK_EARLY_BOOT}`,
      },
    ],
  }),
});

function TalkRoute() {
  const { agent } = Route.useParams();
  const { copyPack, taxAgent } = Route.useLoaderData();
  const bookCall = useServerFn(bookTrialCall);
  return (
    <ProspectTalkLive
      key={agent}
      slug={agent}
      copyPack={copyPack}
      taxAgent={taxAgent}
      onBookCall={(input) => bookCall({ data: input })}
    />
  );
}
