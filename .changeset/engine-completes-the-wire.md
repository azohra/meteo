---
"@azohra/meteo.forecast": minor
---

Builders and `terrain` accept `--sites dataset` to read `sites.json` from the dataset root, so operators no longer keep a site catalogue in their own repository. `publish --models` uploads the packaged model catalogue. `terrain --sync` regenerates and publishes the site context when the published catalogue has moved, and is a no-op when the context is fresh. After every model upload, `publish` reads the manifest back and parses it with the reader contract's guard, so an unconsumable publication fails in the publishing job's log instead of in a consumer's ingest. `sites.json` remains the one root file the engine never writes.
