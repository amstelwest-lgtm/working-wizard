import { useLayoutEffect, useRef, type ReactNode } from "react";
import { HomePagedMenu } from "@/components/client-home/home-paged-menu";
import type { HomePagedView } from "@/lib/home-paged-view";
import "@/components/cash/cash-paged.css";
import "./client-home.css";

/** Under the team cards on accountant client Home. Only the open pane mounts. */
export function ClientHomePaged({
  view,
  onView,
  attentionCount,
  panes,
}: {
  view: HomePagedView;
  onView: (view: HomePagedView) => void;
  attentionCount: number;
  panes: Record<HomePagedView, ReactNode>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const spacer = useRef<HTMLDivElement>(null);
  const menuTop = useRef<number | null>(null);

  const menu = () => root.current?.querySelector<HTMLElement>("[data-home-menu]") ?? null;

  const select = (next: HomePagedView) => {
    const pad = spacer.current;
    if (next !== view && pad) {
      menuTop.current = menu()?.getBoundingClientRect().top ?? null;
      pad.style.height = `${window.innerHeight}px`;
    }
    onView(next);
  };

  // A shorter pane, or one that is briefly short while it mounts, would let the browser
  // pull the page up under the pointer. A screen of room below holds the menu where it
  // was; once the pane settles the room shrinks to what the scroll position still needs.
  useLayoutEffect(() => {
    const pad = spacer.current;
    const top = menuTop.current;
    menuTop.current = null;
    if (!pad || top == null) return;
    const node = menu();
    if (node) window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY - top);
    const trim = window.setTimeout(() => {
      const room = pad.offsetHeight;
      const content = document.documentElement.scrollHeight - room;
      pad.style.height = `${Math.max(0, window.scrollY + window.innerHeight - content)}px`;
    }, 1000);
    return () => window.clearTimeout(trim);
  }, [view]);

  return (
    <>
      <div ref={root} className="cash-paged home-paged" data-home-paged={view}>
        <HomePagedMenu value={view} onChange={select} attentionCount={attentionCount} />
        <section
          role="tabpanel"
          id={`home-pane-${view}`}
          aria-labelledby={`home-menu-${view}`}
          className="cash-paged__pane"
          data-home-pane={view}
        >
          {panes[view]}
        </section>
      </div>
      <div ref={spacer} aria-hidden="true" data-home-paged-spacer="" />
    </>
  );
}
