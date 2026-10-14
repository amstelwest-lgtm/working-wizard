import { createFileRoute } from "@tanstack/react-router";
import { TryDemo } from "@/components/try-demo";
import { trySampleLinks } from "@/styles/app-route-styles";
import tryCss from "../styles/try.css?inline";

export const Route = createFileRoute("/try")({
  component: TryPage,
  head: () => ({
    meta: [
      { title: "Try a sample — Milōn" },
      {
        name: "description",
        content: "A sample health score, findings, and a 13-week cash line. No books to connect.",
      },
      { name: "theme-color", content: "#ffffff" },
    ],
    styles: [{ children: tryCss }],
    links: trySampleLinks,
    scripts: [
      {
        children: `(function(){try{var d=document.documentElement;d.classList.remove("dark");d.setAttribute("data-theme","light");d.style.backgroundColor="#ffffff";d.style.color="#102a43";}catch(e){}})();`,
      },
    ],
  }),
});

function TryPage() {
  return <TryDemo />;
}
