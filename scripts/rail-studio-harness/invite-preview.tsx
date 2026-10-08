/**
 * Fixture frames for the staff-invite landing. No Supabase and no email send.
 */
import { StaffInviteLanding } from "@/components/staff-invite-landing";
import { EmptyState } from "@/components/primitives/empty-state";
import { MetricTile } from "@/components/primitives/metric-tile";
import { PageHeader } from "@/components/primitives/page-header";
import type { StaffInvitePhase } from "@/lib/staff-invite-landing";

const TOKEN = "0123456789abcdef0123456789abcdef";
const EMAIL = "nia@benaccountants.co.za";

type InviteView = "landing" | "create" | "revoked" | "workspace";

export function StaffInvitePreview({ view }: { view: InviteView }) {
  if (view === "workspace") return <JoinedWorkspace />;
  const phase: StaffInvitePhase = view === "revoked" ? "invalid" : "create";
  return (
    <StaffInviteLanding
      token={TOKEN}
      firmName="Ben Accountants"
      memberName="Nia Mokoena"
      memberEmail={EMAIL}
      classification="Read only"
      phase={phase}
      name={view === "create" ? "Nia Mokoena" : "Nia Mokoena"}
      onNameChange={() => undefined}
      password={view === "create" ? "practice-pass" : ""}
      onPasswordChange={() => undefined}
      busy={false}
      error={null}
      notice={null}
      onCreate={(event) => event.preventDefault()}
      onSignIn={(event) => event.preventDefault()}
      onSignOut={() => undefined}
      onGoogleError={() => undefined}
    />
  );
}

function JoinedWorkspace() {
  return (
    <div className="accountant-portal practice-home" data-invite-ready="true" data-staff-invite="workspace">
      <div id="atmos">
        <div className="glow g1" />
        <div className="glow g2" />
        <div className="grid" />
      </div>
      <main className="shell">
        <div className="topbar">
          <span className="brand">
            <span className="gold-text">MILŌN</span>
          </span>
          <span className="profile-chip" title="Ben Accountants">
            Ben Accountants
          </span>
          <span className="spacer" />
          <span className="profile-chip" title={EMAIL}>
            <span className="av">NM</span>
            Nia
          </span>
        </div>
        <PageHeader
          compact
          className="dash-hero"
          eyebrow="Practice"
          title="Good afternoon, Nia"
          subtitle="Ben Accountants · Read only"
        />
        <div className="stats-strip">
          <MetricTile label="Clients" value={0} footnote="Assigned to you" />
          <MetricTile label="Open queries" value={0} footnote="No open queries" />
        </div>
        <div className="clients-head">
          <h2>Clients</h2>
        </div>
        <EmptyState
          title="No client files assigned yet"
          description="You are in the Ben Accountants workspace. A firm admin assigns the files you can open."
        />
      </main>
    </div>
  );
}
