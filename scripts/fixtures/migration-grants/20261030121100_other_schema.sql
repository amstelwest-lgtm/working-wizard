-- expect: pass
CREATE TABLE analytics.events (
  id uuid PRIMARY KEY
);

CREATE TEMP TABLE scratch (
  id uuid PRIMARY KEY
);

CREATE TEMPORARY TABLE scratch_too (
  id int
);
