/** A link only when the firm can open the practice dashboard. Otherwise the label is text. */
export function firmDashboardCrumbIsLink(entitled: boolean | null): boolean {
  return entitled === true;
}

export function FirmDashboardCrumb({
  linked,
  onBack,
}: {
  linked: boolean;
  onBack: () => void;
}) {
  if (!linked) {
    return <span data-firm-dashboard-crumb="text">Firm dashboard</span>;
  }
  return (
    <a
      href="#"
      data-firm-dashboard-crumb="link"
      onClick={(e) => {
        e.preventDefault();
        onBack();
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M19 12H5M12 19l-7-7 7-7" />
      </svg>
      Firm dashboard
    </a>
  );
}
