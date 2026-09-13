/**
 * Owner board business switcher — shown when the login belongs to more than
 * one workspace. Single-business owners see a static chip; invite adds the
 * new business to this list instead of minting a second account.
 */

import type { OwnerWorkspace } from "@/lib/owner-workspaces";

type Props = {
  workspaces: OwnerWorkspace[];
  activeClientId: string | null;
  onSelect: (clientId: string) => void;
  loading?: boolean;
};

export function OwnerBusinessSwitcher({
  workspaces,
  activeClientId,
  onSelect,
  loading,
}: Props) {
  if (loading && workspaces.length === 0) {
    return (
      <span className="owner-biz-chip">
        Business · <b>…</b>
      </span>
    );
  }

  if (workspaces.length === 0) return null;

  if (workspaces.length === 1) {
    const only = workspaces[0]!;
    return (
      <span className="owner-biz-chip" title={only.name}>
        Business · <b>{only.name}</b>
      </span>
    );
  }

  const selected = workspaces.some((w) => w.clientId === activeClientId)
    ? (activeClientId ?? workspaces[0]!.clientId)
    : workspaces[0]!.clientId;

  return (
    <label className="owner-biz-chip owner-biz-switcher">
      <span className="owner-biz-switcher-label">Business</span>
      <select
        aria-label="Switch business"
        value={selected}
        onChange={(e) => {
          const next = e.target.value;
          if (next && next !== activeClientId) onSelect(next);
        }}
      >
        {workspaces.map((w) => (
          <option key={w.clientId} value={w.clientId}>
            {w.name}
          </option>
        ))}
      </select>
    </label>
  );
}
