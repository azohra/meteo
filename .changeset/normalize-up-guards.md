---
"@azohra/meteo.briefing": minor
---

Parse guards normalize up. Every family's guard is now a version chain: the wire schema of each version ever published, oldest first, each carrying the upgrade that lifts it one version forward. A guard parses everything its family ever published and returns the newest shape, refusing only versions newer than the package. A chain never drops a version, because month archives are append-only and immutable, so their documents must stay readable. Every family has one version today, so nothing changes behaviorally; the exported mechanism (`versionedGuard`) is what the first real schemaVersion bump will use. The Compatibility page's rollout section shrinks to one rule: never move a writer to a version no released reader parses; consumers upgrade at their own pace, in any order.
