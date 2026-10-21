/**
 * Minimal rows for the strike-7 billing race and cap-currency tests.
 * Emails and names are not included. Markets match the production shape
 * this app parses (`regionCode`) and the stored `region` field.
 */

export const STRIKE7_OWNER_ID = "11111111-1111-4111-8111-111111111111";
export const STRIKE7_BEN_OWNER_ID = "22222222-2222-4222-8222-222222222222";

/** My practice. The cold-tab gate used this firm. */
export const STRIKE7_MY_PRACTICE_ID = "fca0f102-4c3a-4e21-8a55-6d7e8f901234";

/** Ben. */
export const STRIKE7_BEN_ID = "e8f7a440-a541-422c-8e4f-82ba33dd0604";

export type Strike7FirmRow = {
  id: string;
  owner_user_id: string;
  billing_plan_known: "entitled";
  starter_trial_enforced: false;
  precard_cap_applies: false;
  is_internal?: boolean;
  stripe_customer_id: string | null;
  market: { country: "US"; region: "NY"; regionCode: "NY" };
  clients: Array<{ market: { country: "ZA" | "US"; region?: "NY"; regionCode?: "NY" } }>;
};

const usMarket = { country: "US" as const, region: "NY" as const, regionCode: "NY" as const };

export function strike7MyPracticeRow(): Strike7FirmRow {
  return {
    id: STRIKE7_MY_PRACTICE_ID,
    owner_user_id: STRIKE7_OWNER_ID,
    billing_plan_known: "entitled",
    starter_trial_enforced: false,
    precard_cap_applies: false,
    is_internal: true,
    stripe_customer_id: null,
    market: usMarket,
    clients: [
      { market: { country: "ZA" } },
      { market: { country: "ZA" } },
      { market: { country: "ZA" } },
      { market: { country: "ZA" } },
      { market: { country: "ZA" } },
      { market: usMarket },
    ],
  };
}

export function strike7BenRow(): Strike7FirmRow {
  return {
    id: STRIKE7_BEN_ID,
    owner_user_id: STRIKE7_BEN_OWNER_ID,
    billing_plan_known: "entitled",
    starter_trial_enforced: false,
    precard_cap_applies: false,
    stripe_customer_id: "cus_VIlgPYllDAilft",
    market: usMarket,
    clients: [
      { market: usMarket },
      { market: usMarket },
      { market: usMarket },
      { market: usMarket },
      { market: usMarket },
    ],
  };
}

export function strike7FirmRows(): Strike7FirmRow[] {
  return [strike7MyPracticeRow(), strike7BenRow()];
}
