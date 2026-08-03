import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-slate-300">{label}</Label>
      <div className="flex items-center gap-3">
        <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md border border-slate-700 shadow-sm">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute -inset-1 h-[calc(100%+8px)] w-[calc(100%+8px)] cursor-pointer border-0 bg-transparent p-0 opacity-0"
            aria-label={label}
          />
          <div
            className="h-full w-full"
            style={{ backgroundColor: value }}
          />
        </div>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 font-mono text-xs bg-slate-950/60 border-slate-700 text-slate-200 uppercase w-32"
          maxLength={7}
          spellCheck={false}
        />
        {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
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
      className="overflow-hidden rounded-lg border border-slate-700 bg-white shadow-xl"
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
              <span
                className="text-[17px] font-bold tracking-wide"
                style={{ color: primary }}
              >
                {profile.firmName || "Your Firm Name"}
              </span>
              {profile.tagline && (
                <span
                  className="text-[10px] opacity-70"
                  style={{ color: primary }}
                >
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
        <span className="text-[8px] text-gray-400">
          {profile.firmName || "Your Firm"}
        </span>
      </div>
    </div>
  );
}

function BrandSettingsPage() {
  const { profile, updateProfile } = useAccountantProfile();
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    if (!profile.firmName.trim()) {
      toast.error("Firm name is required.");
      return;
    }
    setSaved(true);
    toast.success("Brand settings saved.");
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <main className="min-h-screen bg-[#07090f] text-slate-50 px-4 py-8">
      <div className="mx-auto max-w-5xl space-y-8">
        {/* Back nav */}
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard"
            className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
        </div>

        {/* Page header */}
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
            Brand Settings
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Personalise every report with your firm's identity. Changes are
            saved to this browser and applied to all generated PDFs.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
          {/* ── LEFT: form ── */}
          <div className="space-y-6">
            {/* Logo */}
            <Card className="border-slate-800 bg-slate-900/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-200">
                  Firm Logo
                </CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Appears top-left on every report. PNG, JPG, or SVG, max 2 MB.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LogoUploader />
              </CardContent>
            </Card>

            {/* Identity */}
            <Card className="border-slate-800 bg-slate-900/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-200">
                  Firm Identity
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-300">
                    Firm Name <span className="text-rose-400">*</span>
                  </Label>
                  <Input
                    value={profile.firmName}
                    onChange={(e) => updateProfile({ firmName: e.target.value })}
                    placeholder="e.g. Clarity Accounting"
                    className="bg-slate-950/60 border-slate-700 text-slate-100 placeholder:text-slate-600 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-300">Tagline</Label>
                  <Input
                    value={profile.tagline ?? ""}
                    onChange={(e) =>
                      updateProfile({
                        tagline: e.target.value || null,
                      })
                    }
                    placeholder="e.g. Clear numbers. Confident decisions."
                    className="bg-slate-950/60 border-slate-700 text-slate-100 placeholder:text-slate-600 text-sm"
                  />
                  <p className="text-[11px] text-slate-500">
                    Shown below firm name when no logo is uploaded.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-300">
                      Accountant Name
                    </Label>
                    <Input
                      value={profile.accountantName}
                      onChange={(e) =>
                        updateProfile({ accountantName: e.target.value })
                      }
                      placeholder="Jane Smith"
                      className="bg-slate-950/60 border-slate-700 text-slate-100 placeholder:text-slate-600 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-300">
                      Accountant Email
                    </Label>
                    <Input
                      type="email"
                      value={profile.accountantEmail}
                      onChange={(e) =>
                        updateProfile({ accountantEmail: e.target.value })
                      }
                      placeholder="jane@clarity.co.za"
                      className="bg-slate-950/60 border-slate-700 text-slate-100 placeholder:text-slate-600 text-sm"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Colours */}
            <Card className="border-slate-800 bg-slate-900/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-200">
                  Colour Palette
                </CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Used for text, borders, and highlights across all reports.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <ColorSwatch
                  label="Primary Colour"
                  value={profile.primaryColor}
                  onChange={(v) => updateProfile({ primaryColor: v })}
                  hint="Text & headings"
                />
                <ColorSwatch
                  label="Secondary Colour"
                  value={profile.secondaryColor}
                  onChange={(v) => updateProfile({ secondaryColor: v })}
                  hint="Backgrounds & fills"
                />
                <ColorSwatch
                  label="Accent Colour"
                  value={profile.accentColor}
                  onChange={(v) => updateProfile({ accentColor: v })}
                  hint="Border lines & highlights"
                />
              </CardContent>
            </Card>

            {/* Save */}
            <div className="flex justify-end">
              <Button
                onClick={handleSave}
                className="gap-2 bg-[#c9962b] hover:bg-[#b8861f] text-white font-semibold"
                disabled={saved}
              >
                <Save className="h-4 w-4" />
                {saved ? "Saved ✓" : "Save Settings"}
              </Button>
            </div>
          </div>

          {/* ── RIGHT: live preview ── */}
          <div className="space-y-4">
            <div className="sticky top-6 space-y-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  Live Preview
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                  Updates as you type — this is how your header and footer will
                  appear on every report.
                </p>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <p className="mb-3 text-[10px] font-mono uppercase tracking-widest text-slate-600">
                  Header
                </p>
                <HeaderPreview />
              </div>

              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-500 leading-relaxed">
                <span className="font-semibold text-slate-400">Note:</span> The
                preview uses HTML rendering. The actual PDF output may have
                minor typographic differences due to the PDF rendering engine.
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
