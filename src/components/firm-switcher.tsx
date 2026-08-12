/**
 * Firm switcher (G27) — shown in accountant topbars when the user belongs to
 * more than one firm. Single-firm users still see a static chip.
 */

import { useAccountantProfile } from "@/contexts/accountant-profile";

export function FirmSwitcher({ className }: { className?: string }) {
  const { firmId, firms, setActiveFirm, brandLoading, profile } = useAccountantProfile();

  if (brandLoading && firms.length === 0) {
    return (
      <span className={`firm-chip ${className ?? ""}`.trim()}>
        Practice · <b>…</b>
      </span>
    );
  }

  if (firms.length === 0) {
    if (!profile.firmName) return null;
    return (
      <span className={`firm-chip ${className ?? ""}`.trim()}>
        Practice · <b>{profile.firmName}</b>
      </span>
    );
  }

  if (firms.length === 1) {
    const only = firms[0]!;
    return (
      <span className={`firm-chip ${className ?? ""}`.trim()}>
        Practice · <b>{only.name || profile.firmName || "—"}</b>
      </span>
    );
  }

  return (
    <label className={`firm-chip firm-switcher ${className ?? ""}`.trim()}>
      <span className="firm-switcher-label">Practice</span>
      <select
        aria-label="Active firm"
        value={firmId ?? firms[0]?.id ?? ""}
        onChange={(e) => {
          const next = e.target.value;
          if (next) void setActiveFirm(next);
        }}
      >
        {firms.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name || "Untitled firm"}
          </option>
        ))}
      </select>
    </label>
  );
}
