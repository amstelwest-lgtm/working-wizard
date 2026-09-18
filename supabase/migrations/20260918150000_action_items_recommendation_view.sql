-- ============================================================================
-- P0.7 — Wire actions to recommendations (view side)
--
-- `action_items_v` was created with `select ai.*`, which froze its column list
-- before P0.2 added `action_items.recommendation_id`. The plan UI reads the
-- view, so the parent recommendation was invisible there. Recreate the view
-- with the FK plus the parent's title / status so the Action Plan can show
-- "From recommendation · <title>" without a second query.
--
-- Additive: no table changes. Idempotent: DROP + CREATE.
-- Depends on: 20260804120000_action_plan.sql, 20260918130000_recommendations_outcomes.sql.
-- ============================================================================

DROP VIEW IF EXISTS public.action_items_v;

CREATE VIEW public.action_items_v
WITH (security_invoker = true) AS
  SELECT ai.*,
         public.action_item_health(ai.status, ai.due_date, ai.progress_pct, ai.created_at) AS health,
         e.name  AS owner_name,
         e.email AS owner_email,
         e.role  AS owner_role,
         (ai.due_date - current_date) AS days_remaining,
         p.title  AS recommendation_title,
         p.status AS recommendation_status,
         p.expected_impact_metric AS recommendation_metric,
         p.expected_impact_amount AS recommendation_amount
  FROM public.action_items ai
  LEFT JOIN public.client_employees e ON e.id = ai.owner_id
  LEFT JOIN public.proposed_next_steps p ON p.id = ai.recommendation_id;

COMMENT ON VIEW public.action_items_v IS
  'action_items + owner + derived health + parent recommendation (P0.7). security_invoker: RLS of the underlying tables applies.';
