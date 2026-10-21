import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TalkIndex } from "@/components/prospect-talk";
import { readMarketingVisitor } from "@/lib/geo-country.functions";
import { sanitizeRef } from "@/lib/prospect-talk";
import talkCss from "../styles/prospect-talk.css?inline";

export const Route = createFileRoute("/talk/")({
  // Same as the agent page: one geo read per visit, so the price lines stay put.
  staleTime: Number.POSITIVE_INFINITY,
  preloadStaleTime: Number.POSITIVE_INFINITY,
  shouldReload: false,
  loader: async () => {
    const visitor = await readMarketingVisitor();
    if (visitor.copyPack === "za") {
      const { zaTalkPriceLine } = await import("@/lib/pricing/za-talk-price.server");
      return { copyPack: "za" as const, priceLine: zaTalkPriceLine() };
    }
    const { usTalkPriceLine } = await import("@/lib/public-pricing-lines");
    return { copyPack: visitor.copyPack, priceLine: usTalkPriceLine() };
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
  const { copyPack, priceLine } = Route.useLoaderData();
  const [refCode, setRefCode] = useState<string | null>(null);
  useEffect(() => {
    setRefCode(sanitizeRef(new URLSearchParams(window.location.search).get("ref")));
  }, []);
  return <TalkIndex refCode={refCode} copyPack={copyPack} priceLine={priceLine} />;
}
