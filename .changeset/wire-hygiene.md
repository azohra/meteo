---
"@azohra/meteo.forecast": minor
---

Dataset reads and the publisher's PUTs now share one S3 client: signing, key encoding, the retryable-code table, and backoff. The endpoint's vendor-neutral name is `METEO_S3_ENDPOINT` (`R2_ENDPOINT` stays honored as an alias). The `freshness` verb retires into `publish --dry-run`, which prints the verdict and the plan without moving a byte; `--cache-closed` is renamed `--cache-closed-months` to match its option. `SITE_FIELDS` derives from the contract's entry schema instead of restating it.
