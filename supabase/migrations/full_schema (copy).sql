--supabase/migrations/full_schema.sql ============================================================
-- Milōn — Complete Database Schema
-- Run this in your Supabase SQL Editor (one paste, all tables)
-- https://supabase.com/dashboard/project/lprakarwxhpybbwuoyij/sql/new
-- ============================================================

-- ── Extensions ────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── 1. Roles ──────────────────────────────────────────────────────────────────
CREATE TYPE public.app_role AS ENUM ('accountant', 'firm_admin', 'client_owner', 'client_member');

CREATE TABLE public.user_roles (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles"   ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "users insert own roles" ON public.user_roles FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- ── 2. Profiles ───────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  TEXT,
  email      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own profile"   ON public.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "update own profile" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 3. Helper functions ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ── 4. Firms ──────────────────────────────────────────────────────────────────
CREATE TABLE public.firms (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  owner_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referral_code  TEXT UNIQUE DEFAULT substr(replace(gen_random_uuid()::TEXT,'-',''),1,10),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.firms ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.firm_memberships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id    UUID NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (firm_id, user_id)
);
ALTER TABLE public.firm_memberships ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_firm_member(_user_id UUID, _firm_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.firm_memberships WHERE user_id = _user_id AND firm_id = _firm_id)
      OR EXISTS (SELECT 1 FROM public.firms WHERE id = _firm_id AND owner_user_id = _user_id);
$$;

CREATE POLICY "firm read by member"    ON public.firms FOR SELECT  TO authenticated USING (owner_user_id = auth.uid() OR public.is_firm_member(auth.uid(), id));
CREATE POLICY "firm insert own"        ON public.firms FOR INSERT  TO authenticated WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY "firm update by owner"   ON public.firms FOR UPDATE  TO authenticated USING (owner_user_id = auth.uid());
CREATE POLICY "firm delete by owner"   ON public.firms FOR DELETE  TO authenticated USING (owner_user_id = auth.uid());
CREATE POLICY "firm memberships read"  ON public.firm_memberships FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_firm_member(auth.uid(), firm_id));
CREATE POLICY "firm memberships insert by owner" ON public.firm_memberships FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.firms f WHERE f.id = firm_id AND f.owner_user_id = auth.uid()));
CREATE POLICY "firm memberships delete by owner" ON public.firm_memberships FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.firms f WHERE f.id = firm_id AND f.owner_user_id = auth.uid()));

-- ── 5. Clients ────────────────────────────────────────────────────────────────
CREATE TABLE public.clients (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  owner_user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  firm_id             UUID REFERENCES public.firms(id) ON DELETE SET NULL,
  business_type       TEXT,
  cash_runway_weeks   NUMERIC,
  last_forecast_at    TIMESTAMPTZ,
  open_queries_count  INT NOT NULL DEFAULT 0,
  last_login_at       TIMESTAMPTZ,
  financials          JSONB,
  cashflow            JSONB,
  contact_email       TEXT,
  contact_phone       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.client_memberships (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, user_id)
);
ALTER TABLE public.client_memberships ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_client_access(_user_id UUID, _client_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clients c WHERE c.id = _client_id AND (
      c.owner_user_id = _user_id
      OR EXISTS (SELECT 1 FROM public.client_memberships m WHERE m.client_id = c.id AND m.user_id = _user_id)
      OR (c.firm_id IS NOT NULL AND public.is_firm_member(_user_id, c.firm_id))
    )
  );
$$;

CREATE POLICY "clients read by access"   ON public.clients FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), id));
CREATE POLICY "clients insert own"       ON public.clients FOR INSERT TO authenticated WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY "clients update by access" ON public.clients FOR UPDATE TO authenticated USING (public.has_client_access(auth.uid(), id));
CREATE POLICY "clients delete by owner"  ON public.clients FOR DELETE TO authenticated USING (owner_user_id = auth.uid());
CREATE POLICY "client memberships read"  ON public.client_memberships FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_client_access(auth.uid(), client_id));
CREATE POLICY "client memberships insert" ON public.client_memberships FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.owner_user_id = auth.uid()));
CREATE POLICY "client memberships delete" ON public.client_memberships FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.clients c WHERE c.id = client_id AND c.owner_user_id = auth.uid()));

GRANT EXECUTE ON FUNCTION public.is_firm_member(UUID, UUID)    TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_client_access(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, anon;

-- ── 6. Impersonation audit ────────────────────────────────────────────────────
CREATE TABLE public.impersonation_audit (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  firm_id       UUID REFERENCES public.firms(id) ON DELETE SET NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ
);
ALTER TABLE public.impersonation_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit insert own"       ON public.impersonation_audit FOR INSERT TO authenticated WITH CHECK (firm_user_id = auth.uid());
CREATE POLICY "audit read own or firm" ON public.impersonation_audit FOR SELECT TO authenticated USING (firm_user_id = auth.uid() OR (firm_id IS NOT NULL AND public.is_firm_member(auth.uid(), firm_id)));
CREATE POLICY "audit update own"       ON public.impersonation_audit FOR UPDATE TO authenticated USING (firm_user_id = auth.uid());

-- ── 7. Financial snapshots ────────────────────────────────────────────────────
CREATE TABLE public.client_financial_snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_label TEXT NOT NULL,
  period_date  DATE NOT NULL,
  financials   JSONB NOT NULL DEFAULT '{}'::JSONB,
  ratios       JSONB NOT NULL DEFAULT '{}'::JSONB,
  source       TEXT NOT NULL DEFAULT 'pdf_upload',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID
);
CREATE INDEX idx_cfs_client_period ON public.client_financial_snapshots(client_id, period_date DESC);
ALTER TABLE public.client_financial_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snapshots read"   ON public.client_financial_snapshots FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "snapshots insert" ON public.client_financial_snapshots FOR INSERT TO authenticated WITH CHECK (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "snapshots update" ON public.client_financial_snapshots FOR UPDATE TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "snapshots delete" ON public.client_financial_snapshots FOR DELETE TO authenticated USING (public.has_client_access(auth.uid(), client_id));

-- ── 8. Industry benchmarks ────────────────────────────────────────────────────
CREATE TABLE public.industry_benchmarks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_type    TEXT NOT NULL,
  metric_key       TEXT NOT NULL,
  p25              NUMERIC NOT NULL,
  p50              NUMERIC NOT NULL,
  p75              NUMERIC NOT NULL,
  unit             TEXT NOT NULL DEFAULT 'pct',
  higher_is_better BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_type, metric_key)
);
ALTER TABLE public.industry_benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "benchmarks readable" ON public.industry_benchmarks FOR SELECT TO authenticated USING (true);

INSERT INTO public.industry_benchmarks (business_type, metric_key, p25, p50, p75, unit, higher_is_better) VALUES
('retail','grossMargin',25,38,50,'pct',true),('retail','operatingMargin',2,5,9,'pct',true),('retail','netMargin',1,3,6,'pct',true),('retail','debtorDays',5,15,30,'days',false),('retail','inventoryDays',30,60,90,'days',false),('retail','creditorDays',20,40,60,'days',true),('retail','assetTurnover',1.5,2.5,3.5,'x',true),('retail','roa',3,7,12,'pct',true),('retail','roe',8,15,25,'pct',true),('retail','fixedCostRatio',15,25,35,'pct',false),
('services','grossMargin',40,55,70,'pct',true),('services','operatingMargin',8,15,22,'pct',true),('services','netMargin',5,10,18,'pct',true),('services','debtorDays',20,40,60,'days',false),('services','creditorDays',15,30,45,'days',true),('services','assetTurnover',0.8,1.5,2.5,'x',true),('services','roa',5,10,18,'pct',true),('services','roe',10,20,30,'pct',true),('services','fixedCostRatio',30,45,60,'pct',false),('services','salesPerEmployee',80000,150000,250000,'money',true),
('saas','grossMargin',60,75,85,'pct',true),('saas','operatingMargin',-10,5,20,'pct',true),('saas','netMargin',-15,2,18,'pct',true),('saas','debtorDays',15,30,50,'days',false),('saas','assetTurnover',0.4,0.8,1.2,'x',true),('saas','roa',-5,5,15,'pct',true),('saas','roe',-10,10,25,'pct',true),('saas','fixedCostRatio',50,65,80,'pct',false),('saas','salesPerEmployee',150000,250000,400000,'money',true),
('hospitality','grossMargin',55,68,78,'pct',true),('hospitality','operatingMargin',5,12,20,'pct',true),('hospitality','netMargin',2,6,12,'pct',true),('hospitality','inventoryDays',5,12,20,'days',false),('hospitality','creditorDays',20,35,50,'days',true),('hospitality','assetTurnover',0.6,1.2,1.8,'x',true),('hospitality','roa',3,8,14,'pct',true),('hospitality','fixedCostRatio',35,50,65,'pct',false),
('construction','grossMargin',12,20,30,'pct',true),('construction','operatingMargin',3,6,10,'pct',true),('construction','netMargin',2,4,7,'pct',true),('construction','debtorDays',30,55,80,'days',false),('construction','creditorDays',30,50,75,'days',true),('construction','assetTurnover',1.2,2.0,3.0,'x',true),('construction','roa',4,8,14,'pct',true),('construction','fixedCostRatio',10,18,28,'pct',false),
('manufacturing','grossMargin',20,32,45,'pct',true),('manufacturing','operatingMargin',5,10,16,'pct',true),('manufacturing','netMargin',3,6,11,'pct',true),('manufacturing','debtorDays',30,50,70,'days',false),('manufacturing','inventoryDays',45,75,110,'days',false),('manufacturing','creditorDays',30,50,70,'days',true),('manufacturing','assetTurnover',0.8,1.4,2.2,'x',true),('manufacturing','roa',4,8,13,'pct',true),('manufacturing','fixedCostRatio',20,30,42,'pct',false),
('professional','grossMargin',45,60,75,'pct',true),('professional','operatingMargin',12,20,30,'pct',true),('professional','netMargin',8,15,25,'pct',true),('professional','debtorDays',25,45,70,'days',false),('professional','assetTurnover',1.0,1.8,2.8,'x',true),('professional','roa',8,15,25,'pct',true),('professional','roe',15,25,40,'pct',true),('professional','fixedCostRatio',25,40,55,'pct',false),('professional','salesPerEmployee',120000,200000,350000,'money',true),
('other','grossMargin',30,45,60,'pct',true),('other','operatingMargin',5,10,17,'pct',true),('other','netMargin',3,7,13,'pct',true),('other','debtorDays',20,40,60,'days',false),('other','inventoryDays',20,45,75,'days',false),('other','creditorDays',20,40,60,'days',true),('other','assetTurnover',1.0,1.7,2.6,'x',true),('other','roa',4,9,15,'pct',true),('other','roe',10,18,28,'pct',true),('other','fixedCostRatio',20,35,50,'pct',false);

-- ── 9. Employees & Tasks ──────────────────────────────────────────────────────
CREATE TABLE public.client_employees (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL,
  name         TEXT NOT NULL,
  email        TEXT,
  role         TEXT,
  weekly_hours NUMERIC,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.client_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employees read"   ON public.client_employees FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "employees insert" ON public.client_employees FOR INSERT TO authenticated WITH CHECK (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "employees update" ON public.client_employees FOR UPDATE TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "employees delete" ON public.client_employees FOR DELETE TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE INDEX idx_client_employees_client ON public.client_employees(client_id);

CREATE TYPE public.employee_task_source AS ENUM ('kpi','improvement','cashflow_line','sop_weekly','manual');
CREATE TYPE public.employee_task_status AS ENUM ('open','done','skipped');

CREATE TABLE public.employee_tasks (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL,
  employee_id  UUID NOT NULL REFERENCES public.client_employees(id) ON DELETE CASCADE,
  source       public.employee_task_source NOT NULL DEFAULT 'manual',
  source_ref   TEXT,
  title        TEXT NOT NULL,
  description  TEXT,
  status       public.employee_task_status NOT NULL DEFAULT 'open',
  due_date     DATE,
  created_by   UUID,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.employee_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks read"   ON public.employee_tasks FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "tasks insert" ON public.employee_tasks FOR INSERT TO authenticated WITH CHECK (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "tasks update" ON public.employee_tasks FOR UPDATE TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "tasks delete" ON public.employee_tasks FOR DELETE TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE INDEX idx_employee_tasks_client   ON public.employee_tasks(client_id);
CREATE INDEX idx_employee_tasks_employee ON public.employee_tasks(employee_id);

-- ── 10. QuickBooks Online ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS qbo_oauth_states (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state      TEXT NOT NULL UNIQUE,
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qbo_connections (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  realm_id       TEXT NOT NULL,
  company_name   TEXT,
  access_token   TEXT NOT NULL,
  refresh_token  TEXT NOT NULL,
  token_expiry   TIMESTAMPTZ NOT NULL,
  connected_at   TIMESTAMPTZ DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  sync_status    TEXT DEFAULT 'idle',
  sync_error     TEXT,
  UNIQUE(client_id)
);

CREATE TABLE IF NOT EXISTS qbo_sync_data (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  data_type  TEXT NOT NULL,
  raw_data   JSONB,
  synced_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, data_type)
);

-- RLS enabled, no policies = service-role only (tokens are never exposed via REST)
ALTER TABLE qbo_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_connections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_sync_data    ENABLE ROW LEVEL SECURITY;
