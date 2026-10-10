/**
 * Local-only route. Not registered on the production router.
 * `/owner-mockup` renders the owner-door mock from src/mockups/owner.
 */
import { useNavigate, useSearch } from "@tanstack/react-router";
import { OwnerDoor, type OwnerScreen, type OwnerTalk } from "@/mockups/owner/owner-door";
import type { AvatarVariant } from "@/mockups/owner/owner-avatars";
import type { OwnerBotKey } from "@/mockups/owner/owner-team";

export function OwnerMockupPage() {
  const search = useSearch({ strict: false }) as {
    screen?: OwnerScreen;
    bot?: OwnerBotKey;
    avatars?: AvatarVariant;
    talk?: OwnerTalk;
  };
  const navigate = useNavigate();
  const avatars = search.avatars === "character" ? "character" : "orb";
  const bot = search.bot ?? "financial_manager";
  return (
    <>
      <div id="atmos" aria-hidden="true">
        <div className="glow g1" />
        <div className="glow g2" />
        <div className="grid" />
      </div>
      <OwnerDoor
        screen={search.screen ?? "home"}
        bot={bot}
        avatars={avatars}
        talk={search.talk ?? "open"}
        onNavigate={(screen, nextBot, talk) => {
          void navigate({
            to: "/owner-mockup",
            search: {
              screen,
              bot: nextBot ?? bot,
              avatars,
              talk: talk ?? "open",
            },
          });
        }}
      />
    </>
  );
}
