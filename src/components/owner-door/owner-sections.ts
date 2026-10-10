import type { OwnerTile } from "@/lib/owner-answers";
import type { OwnerScreen } from "./owner-shell";

export function holdFor(
  screen: OwnerScreen,
  tiles: OwnerTile[],
  actions: { onConnect: () => void; onInvite: () => void; onHome: () => void },
): { title: string; sentence: string; action?: { label: string; onClick: () => void } } | null {
  const tile = (id: OwnerTile["id"]) => tiles.find((item) => item.id === id);
  if (screen === "actions") {
    const answer = tile("answer");
    return {
      title: "Action points",
      sentence: answer?.sentence ?? "Checking action points.",
      action: { label: "Back to home", onClick: actions.onHome },
    };
  }
  if (screen === "accountant") {
    const signed = tile("signed");
    return {
      title: "Accountant",
      sentence: signed?.empty
        ? "Invite your accountant."
        : (signed?.sentence ?? "Invite your accountant."),
      action: signed?.empty
        ? { label: "Invite your accountant", onClick: actions.onInvite }
        : { label: "Back to home", onClick: actions.onHome },
    };
  }
  if (screen === "deliverables") {
    const signed = tile("signed");
    return {
      title: "Deliverables",
      sentence: signed?.sentence ?? "Invite your accountant to sign off.",
      action: {
        label: signed?.empty ? "Invite your accountant" : "Back to home",
        onClick: signed?.empty ? actions.onInvite : actions.onHome,
      },
    };
  }
  if (screen === "plan") {
    return {
      title: "Plan",
      sentence: "The owner plan is on this page.",
      action: { label: "Back to home", onClick: actions.onHome },
    };
  }
  if (screen === "first") {
    return {
      title: "Connect your books",
      sentence: "Connect QuickBooks or Xero.",
      action: { label: "Connect your books", onClick: actions.onConnect },
    };
  }
  if (screen === "settings") {
    return {
      title: "Settings",
      sentence: "Profile, books, and the owner plan.",
      action: { label: "Connect your books", onClick: actions.onConnect },
    };
  }
  return null;
}
