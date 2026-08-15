---
"@azohra/meteo.grib": patch
---

`createNodeJ2kDecoderPool` workers no longer inherit `--input-type` from
  the host process. Node rejects that flag for file-entry workers
  (ERR_INPUT_TYPE_NOT_ALLOWED), so a host started via
  `node --input-type=module -e` could never spawn the pool; the workers'
  execArgv now drops the flag — either spelling — and keeps the rest.
