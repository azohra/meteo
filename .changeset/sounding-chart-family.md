---
"@azohra/meteo.briefing": minor
---

Add the sounding, a second chart family behind the `./sounding` subpath: one forecast hour drawn as a flyable-band vertical profile. `buildSoundingScene(profile, { validAt })` builds a renderer-independent scene — temperature and dew-point traces with one dot per published model level and straight, visibly-interpolated segments between them; a lifted-parcel trace with its LCL; p25–p75 ensemble envelopes; horizontal marks for boundary layer top, cloud base, usable lift top, and the launch; a wind-barb ladder; and pressure secondary ticks — returning null for an instant the profile does not publish and echoing `validAt` so a Meteogram selection can drive it. `renderSoundingSvg` serializes it deterministically under the `--meteo-sounding-*` token family, `buildSoundingKeySpec`/`renderSoundingKeySvg` derive the key from what the scene drew, and `readingAtAltitude` interpolates T/Td/wind/parcel at a pointer position.
