/**
 * Pure checks for firm brand helpers.
 * Run: pnpm exec vite-node --config scripts/vite-test.config.ts scripts/firm-brand-test.mts
 */
import { firmBrandIsEmpty, profileFromFirm, type FirmBrandRow } from "../src/lib/firm-brand";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const emptyFirm: FirmBrandRow = {
  id: "f1",
  name: "Clarity",
  owner_user_id: "u1",
  logo_url: null,
  accent_color: null,
  primary_color: null,
  secondary_color: null,
  tagline: null,
  brand_contact_name: null,
  brand_contact_email: null,
  brand_updated_at: null,
};

assert(firmBrandIsEmpty(emptyFirm), "empty firm");
assert(!firmBrandIsEmpty({ ...emptyFirm, accent_color: "#123456" }), "accent set");

const profile = profileFromFirm({
  ...emptyFirm,
  logo_url: "https://example.com/logo.png",
  accent_color: "#abcdef",
  tagline: "Clear numbers",
  brand_contact_name: "Jane",
  brand_contact_email: "jane@x.co",
});
assert(profile.firmName === "Clarity", "name");
assert(profile.logoUrl?.includes("logo.png") === true, "logo");
assert(profile.accentColor === "#abcdef", "accent");
assert(profile.tagline === "Clear numbers", "tagline");
assert(profile.accountantName === "Jane", "contact name");

console.log("firm-brand-test: ok");
