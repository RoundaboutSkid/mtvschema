#!/usr/bin/env python3
"""Applicera manuella rättelser (corrections.json) på hämtade datafiler.

Körs efter fetch_programme.py / fetch_inofficial.py så att handfixar
överlever automatiska omhämtningar. Uppdaterar både .json och .csv.

Användning:
    python3 apply_corrections.py [--outdir medeltidsveckan_output]
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

DATA_FILES = ["medeltidsveckan_events", "medeltidsveckan_inofficial"]


def matches(event: dict, cond: dict) -> bool:
    return all(str(event.get(k, "")).strip() == str(v).strip() for k, v in cond.items())


def apply_to_events(events: list[dict], corrections: list[dict]) -> int:
    changed = 0
    for corr in corrections:
        cond = corr.get("match") or {}
        new = corr.get("set") or {}
        if not cond or not new:
            continue
        for e in events:
            if matches(e, cond):
                before = {k: e.get(k) for k in new}
                e.update(new)
                if before != {k: e.get(k) for k in new}:
                    changed += 1
    return changed


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--outdir", default="medeltidsveckan_output")
    p.add_argument("--corrections", default="corrections.json")
    args = p.parse_args()

    corr_path = Path(args.corrections)
    if not corr_path.exists():
        print(f"Ingen {corr_path} - inget att göra.")
        return
    corrections = json.loads(corr_path.read_text(encoding="utf-8")).get("corrections", [])
    if not corrections:
        print("Inga rättelser definierade.")
        return

    outdir = Path(args.outdir)
    total = 0
    for stem in DATA_FILES:
        jpath = outdir / f"{stem}.json"
        if not jpath.exists():
            continue
        events = json.loads(jpath.read_text(encoding="utf-8"))
        n = apply_to_events(events, corrections)
        if n:
            jpath.write_text(
                json.dumps(events, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            cpath = outdir / f"{stem}.csv"
            if cpath.exists() and events:
                fields = list(events[0].keys())
                with cpath.open("w", encoding="utf-8-sig", newline="") as f:
                    w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
                    w.writeheader()
                    for e in events:
                        w.writerow(e)
        print(f"{stem}: {n} fält rättade")
        total += n
    print(f"Klart - {total} rättelser applicerade.")


if __name__ == "__main__":
    main()
