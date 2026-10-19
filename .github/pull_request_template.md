## Summary

<!-- What changed, and why. -->

## Other side?

Owner and accountant stay in step. If this PR edits one side of a pair in `parity-map.json`, it must edit the other side too.

- [ ] Both sides updated
- [ ] One side does not apply. Add the line below and write the reason after the em dash:

Other side: N/A —

## Test plan

- [ ] `pnpm test:ci`
- [ ] US bundle scan stays free of ZAR (`node scripts/za-bundle-leak.mjs`)
