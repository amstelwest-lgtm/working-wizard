-- Brand v1.1 default primary is navy #102A43.
-- firms.primary_color has no column default. Older screens saved the
-- previous constant #1A1A2E onto the row, and the settings page shows that
-- stored value. Rewrite only that legacy constant. A colour the practice
-- chose themselves is left alone.

update public.firms
set primary_color = '#102A43'
where lower(btrim(primary_color)) = '#1a1a2e';
