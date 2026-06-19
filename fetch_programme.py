#!/usr/bin/env python3
"""
Fetch the Medeltidsveckan programme and write a normalized data file.

You normally only need to run this once; ``build_schedule.py`` then turns the
data into the timetable. Keep it around so the dataset can be *restored* if the
JSON/CSV is lost.

Pipeline:
1. download the programme page and enumerate every programme item (``data-pid``),
2. for each item, call the site's detail endpoint
   (``/?async=true&action=fetch-programme-item&pid=...``) which returns the
   authoritative date, *start–end* time and venue shown in the event info box,
3. write ``medeltidsveckan_events.json`` (canonical) and a ``.csv`` copy.

Opening-hours listings are intentionally ignored.
"""
from __future__ import annotations

import argparse
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urljoin, urlsplit, urlunsplit

import requests
from bs4 import BeautifulSoup

from medeltidsveckan_common import (
    DEFAULT_DURATION_MINUTES,
    PROGRAMME_URL,
    TIME_RE,
    Event,
    clean,
    dedupe,
    html_to_text,
    infer_end,
    normalize_date,
    save_events_csv,
    save_events_json,
    swedish_weekday,
)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; MedeltidsveckanPlanner/1.0; +local-script)",
    "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
}

TICKET_STATUS_PHRASES = {
    "köp biljett", "buy ticket", "boka", "book",
    "få biljetter kvar", "few tickets left",
    "fullbokad", "slutsåld", "fully booked", "sold out",
}


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #
def fetch(url: str, session: requests.Session | None = None) -> str:
    getter = session or requests
    r = getter.get(url, timeout=30, headers=HEADERS)
    r.raise_for_status()
    return r.text


def event_detail_url(base_url: str, pid: str) -> str:
    parts = urlsplit(base_url)
    origin = urlunsplit((parts.scheme, parts.netloc, "/", "", ""))
    return f"{origin}?async=true&action=fetch-programme-item&pid={pid}"


def fetch_event_detail(session: requests.Session, base_url: str, pid: str) -> dict[str, Any] | None:
    """Fetch a single programme item's detail JSON (date, time range, venue)."""
    headers = {**HEADERS, "X-Requested-With": "XMLHttpRequest"}
    try:
        r = session.get(event_detail_url(base_url, pid), timeout=30, headers=headers)
        r.raise_for_status()
        return r.json()
    except Exception:
        return None


# --------------------------------------------------------------------------- #
# Main-page enumeration
# --------------------------------------------------------------------------- #
def footer_category_status(art: Any) -> tuple[str, str]:
    """Split a card footer into ``(category, ticket-status)``.

    The real category is plain text in the footer (e.g. "Workshop"); ticket
    links live in nested ``<a>`` elements (e.g. "Köp biljett"). The
    ``mv_programme_category-*`` CSS class is a layout-template artefact and is
    NOT reliable, so we never use it.
    """
    footer = art.select_one(".card-footer")
    if not footer:
        return "", ""
    status = clean(" ".join(a.get_text(" ") for a in footer.find_all("a")))
    category = clean("".join(t for t in footer.find_all(string=True) if t.parent.name != "a"))
    if category and category.lower() in TICKET_STATUS_PHRASES:
        status = status or category
        category = ""
    return category, status


def card_start_time(art: Any) -> str | None:
    span = art.select_one(".card-body .float-end") or art.select_one(".float-end")
    if span:
        t = normalize_time_text(span.get_text(" "))
        if t:
            return t
    time_view = art.find_parent("div", class_="time-view")
    if time_view:
        header = time_view.select_one(".time-header h4")
        if header:
            return normalize_time_text(header.get_text(" "))
    return None


def normalize_time_text(text: str) -> str | None:
    m = TIME_RE.search(text or "")
    return f"{int(m.group('h')):02d}:{m.group('m')}" if m else None


def parse_programme_stubs(html_text: str) -> list[dict[str, str]]:
    """Enumerate programme items on the main page.

    Each ``<article class="programme-item" data-pid="...">`` carries a stable
    ``data-pid`` plus the reliable on-page fields: title (``<strong>``),
    category (footer text) and a fallback start time (``.float-end``). The real
    venue and end time live only in the per-item detail API. Opening-hours
    blocks (``<div id="hours-...">``) are intentionally ignored.
    """
    soup = BeautifulSoup(html_text, "html.parser")
    stubs: list[dict[str, str]] = []
    seen: set[str] = set()
    for section in soup.select("section[id^='date-']"):
        date_s = section.get("id", "")[len("date-"):]
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_s):
            continue
        for art in section.select("article.programme-item"):
            pid = (art.get("data-pid") or "").strip()
            if not pid or pid in seen:
                continue
            seen.add(pid)
            title_el = art.find("strong")
            category, status = footer_category_status(art)
            stubs.append({
                "pid": pid,
                "date": date_s,
                "title": clean(title_el.get_text(" ")) if title_el else "",
                "category": category,
                "start": card_start_time(art) or "",
                "status": status,
            })
    return stubs


def parse_time_range(text: str) -> tuple[str | None, str | None]:
    """Parse ``"18:00 - 18:30"`` into ``("18:00", "18:30")``; single time -> end None."""
    found = [f"{int(m.group('h')):02d}:{m.group('m')}" for m in TIME_RE.finditer(text or "")]
    start = found[0] if found else None
    end = found[1] if len(found) > 1 else None
    return start, end


def build_events_from_items(
    stubs: list[dict[str, str]],
    base_url: str,
    default_minutes: int,
    workers: int,
) -> list[Event]:
    """Turn programme-item stubs into events, enriching each via the detail API.

    The detail API is authoritative for date, start/end time and venue; the stub
    supplies the category (absent from the API) and is the fallback on failure.
    """
    session = requests.Session()

    def make_event(stub: dict[str, str]) -> Event | None:
        detail = fetch_event_detail(session, base_url, stub["pid"]) or {}
        sidebar = detail.get("sidebar") or {}
        header = detail.get("header") or {}

        date_s = normalize_date(sidebar.get("date")) or stub["date"]
        start, end = parse_time_range(str(sidebar.get("time") or ""))
        start = start or stub["start"] or None
        if not start:
            return None
        if end:
            duration_source = "source"
        else:
            end = infer_end(start, stub["category"], default_minutes)
            duration_source = "default/category"
        weekday = swedish_weekday(date_s) or clean(str(sidebar.get("dayName") or ""))
        venue = clean(str(sidebar.get("venue") or "")) or "Okänd plats"
        title = clean(str(header.get("title") or "")) or stub["title"]
        if not title:
            return None
        organizer = clean(str(header.get("item_owner") or ""))
        ticket_url = str(sidebar.get("ticket_link") or "").strip()
        status = stub["status"] or ("Köp biljett" if ticket_url else "")
        content = detail.get("content") or {}
        description = html_to_text(str(content.get("description") or ""))
        return Event(
            date_s, weekday, start, end, venue, title,
            organizer=organizer, category=stub["category"], source_url=base_url,
            status=status, ticket_url=ticket_url, description=description,
            duration_source=duration_source,
        )

    events: list[Event] = []
    total = len(stubs)
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = [pool.submit(make_event, s) for s in stubs]
        for done, fut in enumerate(as_completed(futures), start=1):
            ev = fut.result()
            if ev is not None:
                events.append(ev)
            if done % 50 == 0 or done == total:
                print(f"  hämtade detaljer {done}/{total} …", flush=True)
    return dedupe(events)


# --------------------------------------------------------------------------- #
# Embedded-JSON fallback (used only if the page markup changes drastically)
# --------------------------------------------------------------------------- #
def iter_balanced_json_candidates(text: str) -> Iterable[str]:
    """Yield substrings that look like balanced ``{...}`` or ``[...]`` blocks.

    Python's built-in ``re`` module does not support recursive subpatterns, so
    we scan manually while respecting JSON string literals.
    """
    openers = {"{": "}", "[": "]"}
    closers = {"}", "]"}
    i, n = 0, len(text)
    while i < n:
        if text[i] in openers:
            depth = 0
            in_string = False
            escape = False
            j = i
            while j < n:
                c = text[j]
                if in_string:
                    if escape:
                        escape = False
                    elif c == "\\":
                        escape = True
                    elif c == '"':
                        in_string = False
                elif c == '"':
                    in_string = True
                elif c in openers:
                    depth += 1
                elif c in closers:
                    depth -= 1
                    if depth == 0:
                        yield text[i:j + 1]
                        break
                j += 1
            i = j + 1
        else:
            i += 1


def _walk_json(obj: Any) -> Iterable[Any]:
    yield obj
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _walk_json(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk_json(v)


def _first_value(d: dict[str, Any], keys: Iterable[str]) -> Any:
    lower = {str(k).lower(): v for k, v in d.items()}
    for k in keys:
        if k.lower() in lower and lower[k.lower()] not in (None, ""):
            return lower[k.lower()]
    return None


def parse_events_from_embedded_json(html_text: str, base_url: str, default_minutes: int) -> list[Event]:
    soup = BeautifulSoup(html_text, "html.parser")
    roots: list[Any] = []
    for script in soup.find_all("script"):
        txt = (script.string or script.get_text(" ") or "").strip()
        if not txt:
            continue
        if script.get("type") in {"application/json", "application/ld+json"}:
            try:
                roots.append(json.loads(txt))
            except Exception:
                pass
        for piece in iter_balanced_json_candidates(txt):
            if not any(k in piece.lower() for k in ["date", "start", "time", "venue", "plats", "title", "rubrik"]):
                continue
            try:
                roots.append(json.loads(piece))
            except Exception:
                continue

    events: list[Event] = []
    for root in roots:
        for obj in _walk_json(root):
            if not isinstance(obj, dict):
                continue
            title = _first_value(obj, ["title", "name", "rubrik", "heading"])
            start_raw = _first_value(obj, ["start", "startTime", "start_time", "from", "time", "tid"])
            date_raw = _first_value(obj, ["date", "datum", "startDate", "start_date", "day"])
            if not (title and start_raw and date_raw):
                continue
            date_s = normalize_date(date_raw) or normalize_date(start_raw)
            start_s = normalize_time_text(str(start_raw))
            if not (date_s and start_s):
                continue
            end_raw = _first_value(obj, ["end", "endTime", "end_time", "to", "slut"])
            end_s = normalize_time_text(str(end_raw)) if end_raw else None
            category = clean(str(_first_value(obj, ["category", "kategori", "type"]) or ""))
            venue = clean(str(_first_value(obj, ["venue", "place", "location", "plats", "arena"]) or "")) or "Okänd plats"
            url = _first_value(obj, ["url", "link", "permalink"]) or base_url
            if isinstance(url, str):
                url = urljoin(base_url, url)
            if end_s:
                duration_source = "source"
            else:
                end_s = infer_end(start_s, category, default_minutes)
                duration_source = "default/category"
            events.append(Event(
                date_s, swedish_weekday(date_s), start_s, end_s, venue, clean(str(title)),
                category=category, source_url=str(url), duration_source=duration_source,
            ))
    return dedupe(events)


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def main() -> None:
    p = argparse.ArgumentParser(description="Hämtar Medeltidsveckans program till en datafil.")
    p.add_argument("--url", default=PROGRAMME_URL)
    p.add_argument("--outdir", default="medeltidsveckan_output")
    p.add_argument("--default-duration-minutes", type=int, default=DEFAULT_DURATION_MINUTES)
    p.add_argument("--workers", type=int, default=8, help="Antal parallella anrop till detalj-API:t.")
    p.add_argument("--limit", type=int, default=0, help="Begränsa antal event (0 = alla), för test.")
    p.add_argument("--save-html", action="store_true", help="Spara även den råa programme.html.")
    args = p.parse_args()

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    html_text = fetch(args.url, session)
    if args.save_html:
        (outdir / "programme.html").write_text(html_text, encoding="utf-8")

    stubs = parse_programme_stubs(html_text)
    if args.limit and stubs:
        stubs = stubs[: args.limit]

    if stubs:
        print(f"Hittade {len(stubs)} programpunkter. Hämtar plats och tider per event …")
        events = build_events_from_items(stubs, args.url, args.default_duration_minutes, args.workers)
        source = "programlista + detalj-API"
    else:
        events = parse_events_from_embedded_json(html_text, args.url, args.default_duration_minutes)
        source = "inbäddad JSON (fallback)"

    events = dedupe(events)
    if not events:
        raise SystemExit("Inga event kunde läsas. Kontrollera om sidans layout har ändrats.")

    json_path = outdir / "medeltidsveckan_events.json"
    csv_path = outdir / "medeltidsveckan_events.csv"
    save_events_json(events, json_path)
    save_events_csv(events, csv_path)

    print(f"Läste {len(events)} event från {source}.")
    print(f"Skapade: {json_path}")
    print(f"Skapade: {csv_path}")
    print("Kör nu: python build_schedule.py")


if __name__ == "__main__":
    main()
