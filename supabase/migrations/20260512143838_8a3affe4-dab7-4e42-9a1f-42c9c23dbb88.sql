-- Phase 4a: Employees, tasks, SOPs

CREATE TABLE public.client_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  name text NOT NULL,
  email text,
  role text,
  weekly_hours numeric,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.client_employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employees read by client access" ON public.client_employees FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "employees insert by client access" ON public.client_employees FOR INSERT TO authenticated WITH CHECK (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "employees update by client access" ON public.client_employees FOR UPDATE TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "employees delete by client access" ON public.client_employees FOR DELETE TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE INDEX idx_client_employees_client ON public.client_employees(client_id);

CREATE TYPE public.employee_task_source AS ENUM ('kpi','improvement','cashflow_line','sop_weekly','manual');
CREATE TYPE public.employee_task_status AS ENUM ('open','done','skipped');

CREATE TABLE public.employee_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.client_employees(id) ON DELETE CASCADE,
  source public.employee_task_source NOT NULL DEFAULT 'manual',
  source_ref text,
  title text NOT NULL,
  description text,
  status public.employee_task_status NOT NULL DEFAULT 'open',
  due_date date,
  created_by uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.employee_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks read by client access" ON public.employee_tasks FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "tasks insert by client access" ON public.employee_tasks FOR INSERT TO authenticated WITH CHECK (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "tasks update by client access" ON public.employee_tasks FOR UPDATE TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "tasks delete by client access" ON public.employee_tasks FOR DELETE TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE INDEX idx_employee_tasks_client ON public.employee_tasks(client_id);
CREATE INDEX idx_employee_tasks_employee ON public.employee_tasks(employee_id);

CREATE TYPE public.sop_frequency AS ENUM ('weekly');

CREATE TABLE public.employee_sop_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.client_employees(id) ON DELETE CASCADE,
  title text NOT NULL,
  frequency public.sop_frequency NOT NULL DEFAULT 'weekly',
  day_of_week int NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.employee_sop_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sop items read by client access" ON public.employee_sop_items FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "sop items insert by client access" ON public.employee_sop_items FOR INSERT TO authenticated WITH CHECK (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "sop items update by client access" ON public.employee_sop_items FOR UPDATE TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "sop items delete by client access" ON public.employee_sop_items FOR DELETE TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE INDEX idx_sop_items_employee ON public.employee_sop_items(employee_id);

CREATE TABLE public.employee_sop_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sop_item_id uuid NOT NULL REFERENCES public.employee_sop_items(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  week_start date NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  completed_by uuid,
  UNIQUE (sop_item_id, week_start)
);
ALTER TABLE public.employee_sop_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sop log read by client access" ON public.employee_sop_log FOR SELECT TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "sop log insert by client access" ON public.employee_sop_log FOR INSERT TO authenticated WITH CHECK (public.has_client_access(auth.uid(), client_id));
CREATE POLICY "sop log delete by client access" ON public.employee_sop_log FOR DELETE TO authenticated USING (public.has_client_access(auth.uid(), client_id));
CREATE INDEX idx_sop_log_item_week ON public.employee_sop_log(sop_item_id, week_start);