import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { readSignupQuotes, type SignupQuotePack } from "@/lib/pricing/price-quote.functions";

function practiceCode(country: string | null | undefined): "ZA" | "US" {
  return (country ?? "").trim().toUpperCase() === "ZA" ? "ZA" : "US";
}

/**
 * Quotes for the signup country select. A pack for another country is not
 * shown, so a South African practice never flashes the dollar price.
 */
export function useSignupQuotes(
  country: string | null | undefined,
  initial: SignupQuotePack | null | undefined,
): SignupQuotePack | null {
  const read = useServerFn(readSignupQuotes);
  const code = practiceCode(country);
  const [pack, setPack] = useState<SignupQuotePack | null>(
    initial?.country === code ? initial : null,
  );
  const packRef = useRef(pack);
  packRef.current = pack;
  useEffect(() => {
    if (packRef.current?.country === code) return;
    let cancelled = false;
    void read({ data: { country: code } })
      .then((next) => {
        if (!cancelled) setPack(next);
      })
      .catch(() => {
        if (!cancelled) setPack(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, read]);
  return pack?.country === code ? pack : null;
}
