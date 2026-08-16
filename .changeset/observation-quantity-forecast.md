---
"@azohra/meteo.forecast": patch
---

GOES observation documents name their measured quantity: the builder
publishes `quantity: "downwardShortwave"` on goes18-dsr documents and
`"aot"` on goes18-aod, and the packaged catalogue's observation entries
declare the same enum. Additive and optional on the contract, so
documents published before the tag still parse — their quantity absent,
never defaulted.
