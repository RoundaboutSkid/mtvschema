#!/usr/bin/env python3
"""
Fetch the *unofficial* Medeltidsveckan programme from imtv.se.

The unofficial site (https://imtv.se) lists events per day with a start time,
a title, a creator and a free-text description. Unlike the official programme it
has **no end times** and **no structured venue**, so this fetcher:

- infers an end time from a default duration (events tend to be loose hang-outs),
- guesses the venue from keywords in the title/description using a curated map of
  the recurring Visby spots (ports, towers, the moats…), falling back to
  "Okänd plats" when nothing matches.

Every event gets the category ``Inofficiellt`` and is written to
``medeltidsveckan_inofficial.json`` (+ a ``.csv`` copy). ``build_schedule.py``
merges that file into the main schedule automatically, so the unofficial events
show up alongside the official ones and can be toggled on/off via the category
filter.
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
from collections import Counter
from pathlib import Path

import requests
from bs4 import BeautifulSoup

from medeltidsveckan_common import (
    Event,
    clean,
    dedupe,
    infer_end,
    normalize_time,
    save_events_csv,
    save_events_json,
    swedish_weekday,
)

INOFFICIAL_URL = "https://imtv.se/"
INOFFICIAL_CATEGORY = "Inofficiellt"
DEFAULT_DURATION_MINUTES = 90
FALLBACK_VENUE = "Okänd plats"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MedeltidsveckanPlanner/1.0; +local-script)",
    "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
}

# Curated keyword -> venue map for the recurring spots named in the free text.
# More specific / meeting-point places are listed before broad ones so that e.g.
# "Ringmuren runt … samling vid Österport" is grouped under the actual meeting
# point (Österport) rather than the whole wall.
VENUE_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("Nordergravar", ("nordergrav", "nodregrav", "norder grav", "gravrejv", "gravskog", "gravsko")),
    ("Östergravar", ("östergrav", "öster grav")),
    ("Söderport", ("söderport",)),
    ("Norderport", ("norderport",)),
    ("Österport", ("österport",)),
    ("Kärleksporten", ("kärleksport", "karleksport")),
    ("Sankt Göransporten", ("göransport", "sankt göran", "s:t göran")),
    ("Kruttornet", ("kruttornet",)),
    ("Jungfrutornet", ("jungfrutornet",)),
    ("Lokebron", ("lokebron",)),
    ("Strandpromenaden", ("strandpromenad",)),
    ("Murfallet", ("murfallet", "hålet i muren")),
    ("Visby domkyrka", ("domkyrka",)),
    ("Ringmuren", ("ringmuren", "runt muren", "kring muren", "kring ringmuren")),
]

DAY_RE = re.compile(r"(\d{1,2})\s*/\s*(\d{1,2})")
YEAR_RE = re.compile(r"Uppdaterad\s+(\d{4})")


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
def fetch(url: str, session: requests.Session | None = None) -> str:
    getter = session or requests
    r = getter.get(url, timeout=30, headers=HEADERS)
    r.raise_for_status()
    r.encoding = r.apparent_encoding or r.encoding or "utf-8"
    return r.text


# --------------------------------------------------------------------------- #
# Parsing
# --------------------------------------------------------------------------- #
def detect_year(html_text: str, fallback: int) -> int:
    """The festival year, read from the page footer ("Uppdaterad YYYY-…")."""
    m = YEAR_RE.search(html_text)
    return int(m.group(1)) if m else fallback


def guess_venue(text: str) -> str:
    t = text.lower()
    for venue, subs in VENUE_KEYWORDS:
        if any(s in t for s in subs):
            return venue
    return FALLBACK_VENUE


def _extract_link(li) -> str:
    for a in li.find_all("a", href=True):
        href = a["href"].strip()
        if href.startswith("http"):
            return href
    return ""


def _creator(li) -> str:
    mc = li.find("div", class_="modal-content")
    if not mc:
        return ""
    text = mc.get_text("\n", strip=True)
    m = re.search(r"Skapad av:\s*\n?\s*(.+)", text)
    if not m:
        return ""
    name = m.group(1).splitlines()[0].strip()
    # "Admin" is the generic site account, not a meaningful organiser.
    return "" if name.lower() in {"", "admin"} else name


def parse_inofficial(html_text: str, url: str, default_minutes: int, year: int) -> list[Event]:
    soup = BeautifulSoup(html_text, "html.parser")
    dl = soup.find("dl")
    if not dl:
        return []

    events: list[Event] = []
    for dt_el in dl.find_all("dt"):
        heading = clean(dt_el.get_text(" ", strip=True))
        m = DAY_RE.search(heading)
        if not m:
            continue  # e.g. the "Annonser" section has no date
        day_n, month_n = int(m.group(1)), int(m.group(2))
        try:
            date_s = dt.date(year, month_n, day_n).isoformat()
        except ValueError:
            continue
        weekday = swedish_weekday(date_s)

        dd = dt_el.find_next_sibling("dd")
        if not dd:
            continue
        for li in dd.find_all("li"):
            time_el = li.find("span", class_="time")
            if not time_el:
                continue
            start = normalize_time(time_el.get_text(strip=True))
            if not start:
                continue
            h3 = li.find("h3")
            title = clean(h3.get_text(" ", strip=True)) if h3 else ""
            if not title:
                continue

            organizer = _creator(li)
            link = _extract_link(li)
            for modal in li.find_all("div", class_="modal"):
                modal.decompose()  # drop creator/edit metadata before reading the text
            desc = clean(" ".join(p.get_text(" ", strip=True) for p in li.find_all("p")))
            if link and link not in desc:
                desc = f"{desc}\n\nMer info: {link}".strip()

            venue = guess_venue(f"{title} {desc}")
            end = infer_end(start, INOFFICIAL_CATEGORY, default_minutes)
            events.append(Event(
                date=date_s, weekday=weekday, start=start, end=end,
                venue=venue, title=title, organizer=organizer,
                category=INOFFICIAL_CATEGORY, source_url=url,
                status="", ticket_url="", description=desc,
                duration_source="inofficial/inferred",
            ))
    return events


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def main() -> None:
    p = argparse.ArgumentParser(
        description="Hämtar Medeltidsveckans inofficiella program (imtv.se) till en datafil."
    )
    p.add_argument("--url", default=INOFFICIAL_URL)
    p.add_argument("--outdir", default="medeltidsveckan_output")
    p.add_argument("--default-duration-minutes", type=int, default=DEFAULT_DURATION_MINUTES,
                   help="Antagen längd när sluttid saknas (alla inofficiella event saknar sluttid).")
    p.add_argument("--year", type=int, default=0,
                   help="Årtal för datumen (0 = autodetektera från sidan).")
    p.add_argument("--save-html", action="store_true", help="Spara även den råa sidan.")
    args = p.parse_args()

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    html_text = fetch(args.url, session)
    if args.save_html:
        (outdir / "inofficial.html").write_text(html_text, encoding="utf-8")

    year = args.year or detect_year(html_text, dt.date.today().year)
    events = dedupe(parse_inofficial(html_text, args.url, args.default_duration_minutes, year))
    if not events:
        raise SystemExit("Inga inofficiella event kunde läsas. Har sidans layout ändrats?")

    json_path = outdir / "medeltidsveckan_inofficial.json"
    csv_path = outdir / "medeltidsveckan_inofficial.csv"
    save_events_json(events, json_path)
    save_events_csv(events, csv_path)

    located = sum(1 for e in events if e.venue != FALLBACK_VENUE)
    top_venues = Counter(e.venue for e in events).most_common(5)
    print(f"Läste {len(events)} inofficiella event (år {year}).")
    print(f"  Plats hittad för {located}/{len(events)} event. Vanligaste platser: "
          + ", ".join(f"{v} ({n})" for v, n in top_venues))
    print(f"Skapade: {json_path}")
    print(f"Skapade: {csv_path}")
    print("Kör nu: python build_schedule.py")


if __name__ == "__main__":
    main()
