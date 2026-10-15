/** South African provinces. Stored beside regionCode, which stays null for ZA. */

export const ZA_PROVINCES = [
  { code: "EC", name: "Eastern Cape" },
  { code: "FS", name: "Free State" },
  { code: "GP", name: "Gauteng" },
  { code: "KZN", name: "KwaZulu-Natal" },
  { code: "LP", name: "Limpopo" },
  { code: "MP", name: "Mpumalanga" },
  { code: "NC", name: "Northern Cape" },
  { code: "NW", name: "North West" },
  { code: "WC", name: "Western Cape" },
] as const;

export type ZaProvinceCode = (typeof ZA_PROVINCES)[number]["code"];

const CODES = new Set<string>(ZA_PROVINCES.map((row) => row.code));

export function isZaProvinceCode(value: unknown): value is ZaProvinceCode {
  return typeof value === "string" && CODES.has(value);
}

export type ZaVatMode = "exclusive" | "inclusive";

export type ZaMarketExtras = {
  provinceCode: ZaProvinceCode | null;
  vatRegistered: boolean;
  vatMode: ZaVatMode;
};

/** Extra keys on a ZA market blob. US state tax is unchanged. */
export function readZaMarketExtras(raw: unknown): ZaMarketExtras {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    provinceCode: isZaProvinceCode(record.provinceCode) ? record.provinceCode : null,
    vatRegistered: record.vatRegistered === false ? false : true,
    vatMode: record.vatMode === "inclusive" ? "inclusive" : "exclusive",
  };
}

export function zaMarketExtrasJson(extras: ZaMarketExtras): {
  provinceCode: ZaProvinceCode | null;
  vatRegistered: boolean;
  vatMode: ZaVatMode;
} {
  return {
    provinceCode: extras.provinceCode,
    vatRegistered: extras.vatRegistered,
    vatMode: extras.vatMode,
  };
}
