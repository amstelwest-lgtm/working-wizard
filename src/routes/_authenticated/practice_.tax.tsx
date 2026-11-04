import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { askHashForAgent } from "@/lib/ask-agent";
import { parseMarketSelection } from "@/lib/market/parse";
import { TAX_AGENT } from "@/lib/tax-specialist/agents";
import { taxSampleEnabled } from "@/lib/tax-specialist/enabled";

/**
 * Deep link for the Tax Specialist portfolio thread. ZA firms open Home with
 * the tax agent; other markets land on practice Home without the tax hash.
 */
export const Route = createFileRoute("/_authenticated/practice_/tax")({
  component: PracticeTaxRedirect,
  head: () => ({
    meta: [{ title: "Tax Specialist — Milōn" }],
  }),
});

function PracticeTaxRedirect() {
  const navigate = useNavigate();
  const { firmMarket } = useAccountantProfile();
  const country = parseMarketSelection(firmMarket)?.country ?? null;
  const za = taxSampleEnabled(country);

  useEffect(() => {
    void navigate({
      to: "/dashboard",
      hash: za ? askHashForAgent(TAX_AGENT) : undefined,
      replace: true,
    });
  }, [navigate, za]);

  return null;
}
