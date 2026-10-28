import type { ReactNode } from "react";
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
  return (
    <div className="cash-paged home-paged" data-home-paged={view}>
      <HomePagedMenu value={view} onChange={onView} attentionCount={attentionCount} />
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
  );
}
