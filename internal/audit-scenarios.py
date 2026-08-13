#!/usr/bin/env python3
"""Ad-hoc audit: dump pilot-relevant numbers for scenario profiles. Not committed output."""
import json, sys, glob, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def p50(v):
    if v is None: return None
    if isinstance(v, dict): return v.get("p50")
    return v

def kmh(mps):
    return None if mps is None else round(mps * 3.6, 1)

def show(path):
    d = json.load(open(path))
    print(f"\n===== {os.path.basename(path)}  model={d.get('model')} hours={len(d['hours'])}")
    for h in d["hours"]:
        s = h.get("surface", {})
        der = h.get("derived", {})
        lvls = h.get("levels", [])
        lvltxt = " ".join(
            f"{int(p50(l.get('pressureHpa')) or 0)}hPa@{int(p50(l.get('heightM')) or 0)}m:{kmh(p50(l.get('windSpeedMps')))}kmh/{int(p50(l.get('windDirectionDeg')) or 0)}d"
            for l in lvls)
        print(f"{h['validAt'][11:16]} T={p50(s.get('temperatureC'))}C dpd={p50(s.get('dewPointDepressionC'))} "
              f"sfc={kmh(p50(s.get('windSpeedMps')))}kmh/{p50(s.get('windDirectionDeg'))}d gust={kmh(p50(s.get('windGustMps')))}kmh "
              f"shf={p50(s.get('sensibleHeatFluxWm2'))} cape={p50(s.get('capeJkg'))} cin={p50(s.get('cinJkg'))} "
              f"precip={p50(s.get('precipitationMm'))} cc={p50(s.get('cloudCoverPercent'))} slp={p50(s.get('seaLevelPressureHpa'))}")
        print(f"      BL={p50(der.get('boundaryLayerTopM'))}m W*={p50(der.get('thermalVelocityMps'))} "
              f"CB={p50(der.get('cloudBaseM'))}m liftTop={p50(der.get('usableLiftTopM'))}m")
        print(f"      {lvltxt}")

ids = sys.argv[1:]
if not ids:
    ids = sorted(glob.glob(os.path.join(ROOT, "scenarios/generated/*.profile.json")))
else:
    ids = [os.path.join(ROOT, f"scenarios/generated/{i}.profile.json") for i in ids]
for p in ids:
    show(p)
