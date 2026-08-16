---
"@azohra/meteo.briefing": minor
---

New `./compare-board` subpath: one local day across a comparison's members as marks on one shared clock. `buildCompareBoardScene` places each member's thermal windows (clip flags carried), wind-ceiling exceedance spans, cap-timing span and break instant, and rain onset on an Intl-resolved local day axis as fractions plus the cited instants (bars widen by each finding's own step; the cited hours remain the authoritative values) beside launch, gust (reporting class carried), aloft, top, and storms cells, with each non-vote carrying its reason (quiet, abstained, or benched). All winds stay SI m/s. `renderCompareBoardSvg` is the minimal reference serializer, themed by the new `--meteo-board-*` token family.
