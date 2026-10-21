import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TalkIndex } from "@/components/prospect-talk";
import { readMarketingVisitor } from "@/lib/geo-country.functions";
import { sanitizeRef } from "@/lib/prospect-talk";
import talkCss from "../styles/prospect-talk.css?inline";

export const Route = createFileRoute("/talk/")({
  loader: async () => {
    const visitor = await readMarketingVisitor();
    return { copyPack: visitor.copyPack };
  },
  component: TalkIndexRoute,
  head: () => ({
    meta: [
      { title: "Talk to an agent — Milōn" },
      {
        name: "description",
        content: "Milōn agents. A labelled sample. No account.",
      },
      { name: "robots", content: "noindex" },
      { name: "theme-color", content: "#ffffff" },
    ],
    styles: [{ children: talkCss }],
    scripts: [
      {
        children: `(function(){try{var d=document.documentElement;d.classList.remove("dark");d.setAttribute("data-theme","light");d.style.backgroundColor="#ffffff";d.style.color="#102a43";}catch(e){}})();`,
      },
    ],
  }),
});

function TalkIndexRoute() {
  const { copyPack } = Route.useLoaderData();
  const [refCode, setRefCode] = useState<string | null>(null);
  useEffect(() => {
    setRefCode(sanitizeRef(new URLSearchParams(window.location.search).get("ref")));
  }, []);
  return <TalkIndex refCode={refCode} copyPack={copyPack} />;
}
