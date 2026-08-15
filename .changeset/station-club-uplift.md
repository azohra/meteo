---
"@azohra/meteo.station": minor
---

Add four exports first proven in a downstream consumer.
  
  - `historyMeanDirectionDeg` joins the root exports: the circular mean
    over a history window's blowing points — calm points and dead-vane
    nulls contribute nothing, an all-calm window stays null. It always
    existed in the geometry; only the root name was missing (core's
    `meanDirectionDeg` holds the unqualified name).
  - `COMPASS_POINTS` — the ordered 16-point compass list — ships from the
    root beside its `CompassPoint` type; no more deep import for the value.
  - `useMeasuredChartWidth` measures before first paint: a synchronous
    read in a layout effect (`useEffect` on the server) replaces the
    after-paint read that landed a frame late and visibly rescaled the
    chart, and zero-width measurements are ignored — a hidden container
    used to clamp to the guessed fallback width and rescale when shown;
    the hook now stays held (null) until the container is visible. The
    rule is unchanged: null until measured, the fallback width only where
    `ResizeObserver` is missing.
  - `workersCache()` on `@azohra/meteo.station/server`: a `FeedCache` over
    the ambient Cloudflare Workers `caches.default`, undefined off-platform
    so callers fall back to `memoryCache()`. Keys ride a synthetic host
    because the Workers cache refuses URLs with non-standard ports.
