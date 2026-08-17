---
"@azohra/meteo.forecast": minor
---

`meteo forecast publish --model SLUG [--data PATH]`: the engine owns the publication protocol end to end. The verb skips when the build wrote nothing, refuses to publish backwards (an unreachable bucket throws rather than reading as a verdict), uploads history archives before site documents before the manifest — the publication's commit point — with closed month archives on the immutable TTL, then regenerates and uploads `runs.json` from the published manifests. Every object key comes from `documentPaths`, so operator upload scripts no longer restate the layout, the month arithmetic, or the ordering. Cache lifetimes stay the deployment's choice (`--cache-live` / `--cache-closed`, TRIAL defaults caller-movable). `publishModel` and the pure `publishPlan` are exported for programmatic use, and dataset reads now build their keys from `documentPaths` too.
