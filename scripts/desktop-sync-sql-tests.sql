-- Minimal pgTAP-style assertions for desktop_sync migration (CI Postgres).

DO $$
BEGIN
  IF to_regclass('public.desktop_sync_firms') IS NULL THEN
    RAISE EXCEPTION 'desktop_sync_firms missing';
  END IF;
  IF to_regclass('public.desktop_sync_devices') IS NULL THEN
    RAISE EXCEPTION 'desktop_sync_devices missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'register_desktop_sync_source_document'
  ) THEN
    RAISE EXCEPTION 'register_desktop_sync_source_document missing';
  END IF;
END $$;