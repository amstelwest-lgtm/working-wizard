-- One-off backfill for the active findings (13 when this was written).
-- Titles gain sentence case and a full stop, and keep at most two sentences.
-- evidence.status is filled from severity: info → healthy, watch → attention, act → critical.
-- created_at is the first-seen time. superseded_by is left as it is. Nothing is deleted.

CREATE OR REPLACE FUNCTION public.agent_polish_copy(raw text, max_sentences integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  src text := btrim(regexp_replace(coalesce(raw, ''), '\s+', ' ', 'g'));
  len integer;
  i integer := 1;
  start_at integer := 1;
  ch text;
  prev text;
  nxt text;
  piece text;
  sentences text[] := ARRAY[]::text[];
  n integer;
  buf text;
  out text := '';
BEGIN
  IF src = '' THEN
    RETURN '';
  END IF;
  IF src ~ '^[R$£€[:space:]]*-?[0-9][0-9[:space:],]*([.][0-9]+)?%?[.!?]*$' THEN
    RETURN '';
  END IF;
  len := char_length(src);
  WHILE i <= len LOOP
    ch := substr(src, i, 1);
    IF ch IN ('.', '!', '?') THEN
      prev := CASE WHEN i > 1 THEN substr(src, i - 1, 1) ELSE '' END;
      nxt := CASE WHEN i < len THEN substr(src, i + 1, 1) ELSE '' END;
      IF prev !~ '[0-9]' AND nxt !~ '[0-9]' THEN
        piece := btrim(regexp_replace(substr(src, start_at, i - start_at), '[.!?]+$', ''));
        IF piece <> '' THEN
          sentences := sentences || piece;
        END IF;
        i := i + 1;
        WHILE i <= len AND substr(src, i, 1) IN ('.', '!', '?', ' ') LOOP
          i := i + 1;
        END LOOP;
        start_at := i;
        CONTINUE;
      END IF;
    END IF;
    i := i + 1;
  END LOOP;
  piece := btrim(regexp_replace(substr(src, start_at), '[.!?]+$', ''));
  IF piece <> '' THEN
    sentences := sentences || piece;
  END IF;
  n := coalesce(array_length(sentences, 1), 0);
  IF n = 0 THEN
    RETURN src;
  END IF;
  FOR i IN 1..least(max_sentences, n) LOOP
    buf := sentences[i];
    buf := upper(substr(buf, 1, 1)) || substr(buf, 2);
    IF out <> '' THEN
      out := out || ' ';
    END IF;
    out := out || buf || '.';
  END LOOP;
  RETURN out;
END;
$$;

UPDATE public.agent_findings AS finding
SET
  title = CASE WHEN next.polished = '' THEN finding.title ELSE next.polished END,
  evidence = finding.evidence || jsonb_build_object('status', next.copy_status)
FROM (
  SELECT
    id,
    public.agent_polish_copy(title, 2) AS polished,
    CASE severity
      WHEN 'act' THEN 'critical'
      WHEN 'watch' THEN 'attention'
      ELSE 'healthy'
    END AS copy_status
  FROM public.agent_findings
  WHERE superseded_by IS NULL
    AND dismissed_reason IS NULL
) AS next
WHERE finding.id = next.id;

DROP FUNCTION public.agent_polish_copy(text, integer);
