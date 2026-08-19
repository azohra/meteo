---
"@azohra/meteo.core": minor
"@azohra/meteo.briefing": patch
"@azohra/meteo.station": minor
---

Core gains `solarEventsForDate` (briefing's Meeus sunrise/sunset, moved so station shares the same astronomy; briefing re-exports it unchanged). The wind chart gains `nightShading` (`night-shading`): gray sunset-to-sunrise columns from the station's own coordinates; without coordinates, and on polar day and night, nothing draws. The client entry gains window math for a host-composed archive pager (the library ships no archive control surface; the pager's look is the host's product decision): `archivePeriodFor` over the vendor-shaped resolution ladder (TRIAL craft parameters `ARCHIVE_DEFAULT_PERIODS_MINUTES`, `ARCHIVE_TARGET_POINTS`), LOCAL calendar-day arithmetic (`archiveDayWindow`, `archiveDayValue`, `archiveDayStep`), and `archiveTrailingWindow`.
