# Statement text-layer fixtures

`scripts/statement-text-layer-test.mts` builds two minimal PDFs in memory:

- a text-layer trial balance (equipment at cost 95,000 and accumulated depreciation 27,000)
- a page with no text, standing in for a scan

The real prod sample is `qa/t279/tb-midyear-sept-2026.pdf` on the coordinator. It is not in this repo. To run the same checks against it:

```bash
STATEMENT_TEXT_LAYER_GOOD_PDF=/absolute/path/tb-midyear-sept-2026.pdf \
STATEMENT_TEXT_LAYER_SCAN_PDF=/absolute/path/scan.pdf \
pnpm test:statement-text-layer
```

The synthesized trial balance still runs either way. A good QA file must take the redacted-text path (no raw PDF bytes in the model payload). A scan must keep the original bytes.
