import { useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { FirmVoucherCheckResult } from "@/components/firm-band-upgrade";
import { FIRM_VOUCHER_INVALID_MESSAGE } from "@/lib/firm-voucher";
import { validateFirmVoucher } from "@/lib/stripe-checkout.functions";
import type { FirmCheckoutBand, FirmInterval } from "@/lib/stripe-plans";

export function useFirmVoucherCheck(firmId: string | null) {
  const validate = useServerFn(validateFirmVoucher);
  return useCallback(
    async (input: {
      code: string;
      band: FirmCheckoutBand;
      interval: FirmInterval;
    }): Promise<FirmVoucherCheckResult> => {
      if (!firmId) return { ok: false, message: FIRM_VOUCHER_INVALID_MESSAGE };
      try {
        const result = await validate({ data: { firmId, ...input } });
        if (!result.ok)
          return { ok: false, message: result.message || FIRM_VOUCHER_INVALID_MESSAGE };
        return {
          ok: true,
          promotionCodeId: result.promotionCodeId,
          preview: result.preview,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message.trim() : "";
        return { ok: false, message: message || FIRM_VOUCHER_INVALID_MESSAGE };
      }
    },
    [firmId, validate],
  );
}
