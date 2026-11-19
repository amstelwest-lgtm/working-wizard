-- Minimal checks for desktop_sync migration (CI Postgres).

DO $$
BEGIN
  IF to_regclass('public.desktop_sync_firms') IS NULL THEN
    RAISE EXCEPTION 'desktop_sync_firms missing';
  END IF;
  IF to_regclass('public.desktop_sync_devices') IS NULL THEN
    RAISE EXCEPTION 'desktop_sync_devices missing';
  END IF;
  IF to_regclass('public.desktop_sync_daily_usage') IS NOT NULL THEN
    RAISE EXCEPTION 'desktop_sync_daily_usage must not exist';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'desktop_sync_devices'
      AND column_name = 'usage_date'
  ) THEN
    RAISE EXCEPTION 'desktop_sync_devices.usage_date missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'register_desktop_sync_source_document'
  ) THEN
    RAISE EXCEPTION 'register_desktop_sync_source_document missing';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'register_desktop_sync_source_document'
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'register_desktop_sync_source_document must be invoker not definer';
  END IF;
END $$;