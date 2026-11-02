---
"@azohra/meteo.forecast": patch
---

Survive bursts of dropped connections from the ECCC hpfx mirror. The run-discovery probe (`exists`) now retries a dropped connection, throttling or a 5xx the way the Datamart, NOAA and dataset fetches do, and throws once its attempts are spent, where it used to fail the build on the first reset and read a 5xx as "not published". The shared backoff now starts at 15 s instead of 0.25 s, spreading three attempts over about 45 s. A missing `METEO_R2_BUCKET` now fails at once instead of being retried.
