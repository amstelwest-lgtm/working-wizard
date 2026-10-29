-- Week-net proposals. "Change W1 net by 100" is netWeek 1 and netDelta 100.
-- figure_normalize_patch rejected those keys, so confirm raised figure_patch_key.
-- Apply replaces the normalizer. The pending insert does not call it.
-- Same manual apply as 20261029120000_figure_proposals.sql. Not in the CI script.

CREATE OR REPLACE FUNCTION public.figure_normalize_patch(p_surface text, p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_allowed text[];
  v_out jsonb := '{}'::jsonb;
  v_num numeric;
BEGIN
  IF p_surface = 'cash' THEN
    v_allowed := ARRAY[
      'openingBalance', 'revAdj', 'expAdj', 'collectDelay', 'headcountDelta',
      'avgSalary', 'fixedCostDelta', 'revGrowthPct', 'capexAmount', 'capexWeek',
      'netWeek', 'netDelta'
    ];
  ELSIF p_surface = 'budget' THEN
    v_allowed := ARRAY['openingCash', 'gpPct', 'debtorDays', 'creditorDays', 'inventoryDays'];
  ELSIF p_surface = 'waterfall' THEN
    v_allowed := ARRAY['revenue', 'cogs', 'grossProfit', 'fixedCosts', 'ebit', 'interest', 'tax', 'netIncome'];
  ELSE
    RAISE EXCEPTION 'figure_surface_invalid';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'figure_patch_invalid';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'figure_patch_key';
    END IF;
    BEGIN
      v_num := (p_patch ->> v_key)::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'figure_patch_value';
    END;
    IF v_num IS NULL THEN
      RAISE EXCEPTION 'figure_patch_value';
    END IF;

    IF p_surface = 'cash' AND v_key = 'revAdj' AND (v_num < 50 OR v_num > 150) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'cash' AND v_key = 'expAdj' AND (v_num < 50 OR v_num > 150) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'cash' AND v_key = 'collectDelay' AND (v_num <> trunc(v_num) OR v_num < 0 OR v_num > 6) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'cash' AND v_key = 'headcountDelta' AND (v_num <> trunc(v_num) OR v_num < -100 OR v_num > 100) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'cash' AND v_key = 'revGrowthPct' AND (v_num < -10 OR v_num > 10) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'cash' AND v_key = 'capexWeek' AND (v_num <> trunc(v_num) OR v_num < 1 OR v_num > 13) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'cash' AND v_key = 'netWeek' AND (v_num <> trunc(v_num) OR v_num < 1 OR v_num > 13) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'cash' AND v_key IN ('avgSalary', 'capexAmount') AND v_num < 0 THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'budget' AND v_key = 'gpPct' AND (v_num < 0 OR v_num > 100) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'budget' AND v_key IN ('debtorDays', 'creditorDays', 'inventoryDays')
      AND (v_num <> trunc(v_num) OR v_num < 0 OR v_num > 365) THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF p_surface = 'waterfall' AND v_key IN ('revenue', 'cogs', 'fixedCosts') AND v_num < 0 THEN
      RAISE EXCEPTION 'figure_patch_value';
    ELSIF abs(v_num) > 1000000000000 THEN
      RAISE EXCEPTION 'figure_patch_value';
    END IF;

    IF p_surface = 'cash' AND v_key IN ('openingBalance', 'avgSalary', 'fixedCostDelta', 'capexAmount') THEN
      v_out := v_out || jsonb_build_object(v_key, to_jsonb((round(v_num, 2))::text));
    ELSIF p_surface = 'cash' AND v_key IN ('collectDelay', 'headcountDelta', 'capexWeek', 'netWeek') THEN
      v_out := v_out || jsonb_build_object(v_key, to_jsonb(v_num::int));
    ELSIF p_surface = 'budget' AND v_key IN ('debtorDays', 'creditorDays', 'inventoryDays') THEN
      v_out := v_out || jsonb_build_object(v_key, to_jsonb(v_num::int));
    ELSE
      v_out := v_out || jsonb_build_object(v_key, to_jsonb(round(v_num, 2)));
    END IF;
  END LOOP;

  IF v_out = '{}'::jsonb THEN
    RAISE EXCEPTION 'figure_patch_empty';
  END IF;
  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.figure_normalize_patch(text, jsonb) FROM PUBLIC, anon, authenticated;
