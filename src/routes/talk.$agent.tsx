import { createFileRoute } from "@tanstack/react-router";
import { ProspectTalkLive } from "@/components/prospect-talk";
import { readMarketingVisitor } from "@/lib/geo-country.functions";
import tryCss from "../styles/try.css?inline";
import talkCss from "../styles/prospect-talk.css?inline";

export const Route = createFileRoute("/talk/$agent")({
  loader: async () => {
    const visitor = await readMarketingVisitor();
    return { copyPack: visitor.copyPack };
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
        children: `(function(){try{var d=document.documentElement;d.classList.remove("dark");d.setAttribute("data-theme","light");d.style.backgroundColor="#ffffff";d.style.color="#102a43";}catch(e){}})();`,
      },
    ],
  }),
});

function TalkRoute() {
  const { agent } = Route.useParams();
  const { copyPack } = Route.useLoaderData();
  return <ProspectTalkLive slug={agent} copyPack={copyPack} />;
}
