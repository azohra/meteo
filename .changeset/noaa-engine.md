---
"@azohra/meteo.forecast": patch
---

The HRRR, GFS, NAM, and RRFS builders — four copies of the same idx-record pipeline — merge into one NOAA engine driven by a `NoaaModel` descriptor. Each model's real facts stay declarative: file grammars and completion probes, field tables with converts, smoke speciation, DPT-vs-RH level moisture, VVEL-vs-DZDT vertical velocity, Lambert rotation, and per-model precipitation algebra as small strategy closures. Published documents, manifests, and log lines are unchanged.
