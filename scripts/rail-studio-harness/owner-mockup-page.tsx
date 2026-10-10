/**
 * Local-only route. Not registered on the production router.
 * `/owner-mockup` renders the owner-door mock from src/mockups/owner.
 */
import { useNavigate, useSearch } from "@tanstack/react-router";
import { OwnerDoor, type OwnerScreen } from "@/mockups/owner/owner-door";
import type { OwnerBotKey } from "@/mockups/owner/owner-team";

export function OwnerMockupPage() {
  const search = useSearch({ strict: false }) as { screen?: OwnerScreen; bot?: OwnerBotKey };
  const navigate = useNavigate();
  return (
    <>
      <div id="atmos" aria-hidden="true">
        <div className="glow g1" />
        <div className="glow g2" />
        <div className="grid" />
      </div>
      <OwnerDoor
        screen={search.screen ?? "home"}
        bot={search.bot ?? "analyst"}
        onNavigate={(screen, bot) => {
          void navigate({
            to: "/owner-mockup",
            search: { screen, bot: bot ?? search.bot ?? "analyst" },
          });
        }}
      />
    </>
  );
}
