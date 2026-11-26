/**
 * Firm switcher (G27) — shown in accountant topbars when the user belongs to
 * more than one firm. Single-firm users still see a static chip.
 */

import { useAccountantProfile } from "@/contexts/accountant-profile";
import { practiceChipName } from "@/lib/accountant-identity";

export function FirmSwitcher({ className, firmId: firmIdProp }: { className?: string; firmId?: string | null }) {
  const { firmId, firms, setActiveFirm, brandLoading, profile, headerName, personNames } = useAccountantProfile();
  const pinnedFirmId = typeof firmIdProp === "string" && firmIdProp.trim() ? firmIdProp.trim() : null;
  const activeId = pinnedFirmId || firmId;
  // A client page passes that client's firm. Do not fall back to another firm or the profile name.
  const active =
    firms.find((firm) => firm.id === activeId) ?? (pinnedFirmId ? null : firms.length === 1 ? firms[0] : null);
  const practiceName = practiceChipName({
    firmName: active?.name,
    profileFirmName: pinnedFirmId ? "" : profile.firmName,
    personName: headerName || profile.accountantName,
    personNames,
  });

  if (brandLoading && firms.length === 0) {
    return (
      <span className={`firm-chip firm-chip--pending ${className ?? ""}`.trim()} aria-busy="true">
        <span className="milon-skeleton firm-chip__skeleton" />
        <span className="sr-only">Loading practice</span>
      </span>
    );
  }

  // Client pages always use the firm row for that client, even when the
  // account can switch firms. A person-named row stays blank.
  if (pinnedFirmId || firms.length <= 1) {
    if (!practiceName) return null;
    return (
      <span className={`firm-chip ${className ?? ""}`.trim()}>
        Practice · <b>{practiceName}</b>
      </span>
    );
  }

  return (
    <label className={`firm-chip firm-switcher ${className ?? ""}`.trim()}>
      <span className="firm-switcher-label">Practice</span>
      <select
        aria-label="Active firm"
        value={activeId ?? firms[0]?.id ?? ""}
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
