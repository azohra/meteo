---
"@azohra/meteo.briefing": minor
---

New `derive` export `parcelAscent`: one virtual-temperature surface-parcel ascent — dry adiabatic to the LCL, moist pseudo-adiabatic above it — sampling buoyancy at exactly the published levels, with a TRIAL `entrainmentPerM` craft parameter (default 0, an undiluted parcel). `thermalIndexC` and `thermalIndexProfile` now ride this parcel: the sign convention is unchanged, but thermal-index values shift slightly in moist boundary layers because vapour now counts toward buoyancy, and levels above the LCL follow the moist branch instead of the dry adiabat. Dew points are additive-optional on the thermal-index entry points; omitted, the previous dry-adiabatic comparison is reproduced. New moisture helpers: `saturationVaporPressureHpa`, `mixingRatioKgKg`, `saturationMixingRatioKgKg`, `virtualTemperatureC`.
