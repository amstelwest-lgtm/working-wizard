/**
 * Owner board business switcher — shown when the login belongs to more than
 * one workspace. Single-business owners see a static chip; invite adds the
 * new business to this list instead of minting a second account.
 */

import { Building2, Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  canOpenOwnerWorkspace,
  type OwnerWorkspace,
} from "@/lib/owner-workspaces";

type Props = {
  workspaces: OwnerWorkspace[];
  activeClientId: string | null;
  onSelect: (clientId: string) => void;
  loading?: boolean;
};

function ChipFace({
  name,
  interactive,
}: {
  name: string;
  interactive?: boolean;
}) {
  return (
    <>
      <span className="owner-biz-switcher-mark" aria-hidden>
        <Building2 />
      </span>
      <span className="owner-biz-switcher-copy">
        <span className="owner-biz-switcher-label">Business</span>
        <b>{name}</b>
      </span>
      {interactive ? <ChevronDown className="owner-biz-switcher-chevron" aria-hidden /> : null}
    </>
  );
}

export function OwnerBusinessSwitcher({
  workspaces,
  activeClientId,
  onSelect,
  loading,
}: Props) {
  if (loading && workspaces.length === 0) {
    return (
      <span className="owner-biz-chip">
        <ChipFace name="…" />
      </span>
    );
  }

  if (workspaces.length === 0) return null;

  if (workspaces.length === 1) {
    const only = workspaces[0]!;
    return (
      <span className="owner-biz-chip" title={only.name}>
        <ChipFace name={only.name} />
      </span>
    );
  }

  const selected = canOpenOwnerWorkspace(workspaces, activeClientId)
    ? (activeClientId as string)
    : workspaces[0]!.clientId;
  const active = workspaces.find((w) => w.clientId === selected) ?? workspaces[0]!;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="owner-biz-chip owner-biz-switcher"
          aria-label={`Switch business, ${active.name} selected`}
        >
          <ChipFace name={active.name} interactive />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="owner-biz-menu">
        <div className="owner-biz-menu-rule" aria-hidden />
        <p className="owner-biz-menu-kicker">Your businesses</p>
        <p className="owner-biz-menu-hint">Only workspaces this login owns or was invited to.</p>
        {workspaces.map((w) => (
          <DropdownMenuItem
            key={w.clientId}
            className="owner-biz-menu-item"
            aria-current={w.clientId === selected ? "true" : undefined}
            onSelect={() => {
              if (!canOpenOwnerWorkspace(workspaces, w.clientId) || w.clientId === activeClientId) {
                return;
              }
              onSelect(w.clientId);
            }}
          >
            <span className="owner-biz-menu-item-main">
              <span className="owner-biz-menu-item-name">{w.name}</span>
              <span className="owner-biz-menu-item-role">
                {w.role === "owner" ? "Owner" : "Team seat"}
              </span>
            </span>
            {w.clientId === selected ? (
              <Check className="owner-biz-menu-check" aria-hidden />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
