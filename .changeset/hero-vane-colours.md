---
"@azohra/meteo.station": patch
---

The committed hero figures regain their vane stroke and band fill: the asset generator read `t.vane`/`t["band-fill"]` where the token short names are `wind-vane`/`wind-band-fill`, so both styles rendered as `undefined`. Fixture speeds now convert through core's `kmhToMps` (same spelling, same bits).
