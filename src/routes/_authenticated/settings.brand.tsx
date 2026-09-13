import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { BackLink } from "@/components/back-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionCard } from "@/components/primitives";
import { SettingsShell } from "@/components/settings-shell";
import { LogoUploader } from "@/components/logo-uploader";
import { useAccountantProfile } from "@/contexts/accountant-profile";

export const Route = createFileRoute("/_authenticated/settings/brand")({
  component: BrandSettingsPage,
  head: () => ({ meta: [{ title: "Brand Settings — Milōn" }] }),
});

function ColorSwatch({
  label,
  value,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="settings-label">{label}</Label>
      <div className="flex items-center gap-3">
        <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-[var(--line)] shadow-sm">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="absolute -inset-1 h-[calc(100%+8px)] w-[calc(100%+8px)] cursor-pointer border-0 bg-transparent p-0 opacity-0 disabled:cursor-not-allowed"
            aria-label={label}
          />
          <div className="h-full w-full" style={{ backgroundColor: value }} />
        </div>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-9 w-32 font-mono text-xs uppercase"
          maxLength={7}
          spellCheck={false}
        />
        {hint && <span className="text-[11px] text-[var(--ink-faint)]">{hint}</span>}
      </div>
    </div>
  );
}

function HeaderPreview() {
  const { profile } = useAccountantProfile();
  const accent = profile.accentColor || "#0f3460";
  const primary = profile.primaryColor || "#1a1a2e";

  return (
    <div
      className="overflow-hidden rounded-lg border border-[var(--line)] bg-white shadow-xl"
      style={{ fontFamily: "system-ui, sans-serif" }}
    >
      <div
        className="flex items-center justify-between px-10 py-6"
        style={{ backgroundColor: "#ffffff" }}
      >
        <div className="flex flex-col gap-1">
          {profile.logoUrl ? (
            <img
              src={profile.logoUrl}
              alt="Firm logo"
              className="max-h-11 max-w-36 object-contain"
            />
          ) : (
            <>
              <span className="text-[17px] font-bold tracking-wide" style={{ color: primary }}>
                {profile.firmName || "Your Firm Name"}
              </span>
              {profile.tagline && (
                <span className="text-[10px] opacity-70" style={{ color: primary }}>
                  {profile.tagline}
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[9px] opacity-60" style={{ color: primary }}>
            Prepared for:
          </span>
          <span className="text-[13px] font-bold" style={{ color: primary }}>
            Acme (Pty) Ltd
          </span>
          <span className="text-[9px] opacity-65" style={{ color: primary }}>
            Period: June 2025
          </span>
          {profile.accountantEmail && (
            <span className="text-[8.5px] mt-1 opacity-50" style={{ color: primary }}>
              {profile.accountantEmail}
            </span>
          )}
        </div>
      </div>

      <div className="h-[2px]" style={{ backgroundColor: accent }} />

      <div
        className="flex items-center justify-between px-10 py-3"
        style={{ backgroundColor: "#f9f9f9" }}
      >
        <span className="text-[8px] text-gray-400">
          Powered by <span className="font-semibold text-gray-500">Milōn</span>
        </span>
        <span className="text-[8px] text-gray-400">Page 1 of 1</span>
        <span className="text-[8px] text-gray-400">{profile.firmName || "Your Firm"}</span>
      </div>
    </div>
  );
}

function BrandSettingsPage() {
  const { profile, updateProfile, saveProfile, canEditBrand, brandLoading, firmId } =
    useAccountantProfile();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!profile.firmName.trim()) {
      toast.error("Firm name is required.");
      return;
    }
    if (!canEditBrand) {
      toast.error("Only the firm owner can save brand settings.");
      return;
    }
    setSaving(true);
    try {
      const result = await saveProfile();
      if (!result.ok) {
        toast.error(result.error ?? "Could not save brand settings.");
        return;
      }
      setSaved(true);
      toast.success("Brand settings saved for your practice.");
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const readOnly = !canEditBrand;

  return (
    <SettingsShell width="xl">
      <BackLink to="/settings" className="mb-3">
        Back to settings
      </BackLink>
      <PageHeader
        compact
        className="mb-8"
        eyebrow="Practice"
        title="Brand settings"
        subtitle="Personalise every report with your firm's identity. Changes are saved to your practice and shared with your team on every device."
        meta={<ThemeToggle />}
      />
      {brandLoading && <p className="mb-4 text-xs text-[var(--ink-dim)]">Loading firm brand…</p>}
      {!brandLoading && !firmId && (
        <p className="mb-4 text-xs text-[var(--warn)]">
          No firm found yet — finish accountant signup so brand can sync.
        </p>
      )}
      {!brandLoading && firmId && readOnly && (
        <p className="mb-4 text-xs text-[var(--warn)]">
          Viewing as a firm member — only the firm owner can edit brand.
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
        <div className="space-y-6">
          <SectionCard
            eyebrow="Firm logo"
            description="Appears top-left on every report. PNG, JPG, or SVG, max 2 MB."
          >
            <LogoUploader />
          </SectionCard>

          <SectionCard eyebrow="Firm identity">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="settings-label">
                  Firm Name <span className="text-[var(--risk)]">*</span>
                </Label>
                <Input
                  value={profile.firmName}
                  onChange={(e) => updateProfile({ firmName: e.target.value })}
                  placeholder="e.g. Clarity Accounting"
                  disabled={readOnly}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="settings-label">Tagline</Label>
                <Input
                  value={profile.tagline ?? ""}
                  onChange={(e) =>
                    updateProfile({
                      tagline: e.target.value || null,
                    })
                  }
                  placeholder="e.g. Clear numbers. Confident decisions."
                  disabled={readOnly}
                />
                <p className="text-[11px] text-[var(--ink-faint)]">
                  Shown below firm name when no logo is uploaded.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="settings-label">Accountant Name</Label>
                  <Input
                    value={profile.accountantName}
                    onChange={(e) => updateProfile({ accountantName: e.target.value })}
                    placeholder="Jane Smith"
                    disabled={readOnly}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="settings-label">Accountant Email</Label>
                  <Input
                    type="email"
                    value={profile.accountantEmail}
                    onChange={(e) => updateProfile({ accountantEmail: e.target.value })}
                    placeholder="jane@clarity.co.za"
                    disabled={readOnly}
                  />
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            eyebrow="Colour palette"
            description="Used for text, borders, and highlights across all reports."
          >
            <div className="space-y-5">
              <ColorSwatch
                label="Primary Colour"
                value={profile.primaryColor}
                onChange={(v) => updateProfile({ primaryColor: v })}
                hint="Text & headings"
                disabled={readOnly}
              />
              <ColorSwatch
                label="Secondary Colour"
                value={profile.secondaryColor}
                onChange={(v) => updateProfile({ secondaryColor: v })}
                hint="Backgrounds & fills"
                disabled={readOnly}
              />
              <ColorSwatch
                label="Accent Colour"
                value={profile.accentColor}
                onChange={(v) => updateProfile({ accentColor: v })}
                hint="Border lines & highlights"
                disabled={readOnly}
              />
            </div>
          </SectionCard>

          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              className="settings-gold gap-2"
              disabled={saved || saving || readOnly || brandLoading}
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : saved ? "Saved ✓" : "Save Settings"}
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="sticky top-6 space-y-3">
            <div>
              <p className="settings-label">Live preview</p>
              <p className="mt-1 text-xs text-[var(--ink-dim)]">
                Updates as you type — this is how your header and footer will appear on every
                report.
              </p>
            </div>

            <div className="settings-preview">
              <p className="settings-label mb-3">Header</p>
              <HeaderPreview />
            </div>

            <p className="text-xs leading-relaxed text-[var(--ink-dim)]">
              <span className="font-semibold text-[var(--ink)]">Note:</span> The preview uses HTML
              rendering. The actual PDF output may have minor typographic differences due to the PDF
              rendering engine.
            </p>
          </div>
        </div>
      </div>
    </SettingsShell>
  );
}
