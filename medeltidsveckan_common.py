#!/usr/bin/env python3
"""
Shared building blocks for the Medeltidsveckan tooling.

This module is intentionally *not* a runnable script. It holds the data model
and the bits that both the fetcher (``fetch_programme.py``) and the renderer
(``build_schedule.py``) need:

- the :class:`Event` data model and time helpers,
- category metadata and inferred durations,
- JSON/CSV load & save helpers for the intermediate data file,
- the timeline *lane layout* algorithm (interval graph colouring) used to place
  overlapping events side by side while letting multi-slot events stay as a
  single continuous block.
"""
from __future__ import annotations

import csv
import dataclasses
import datetime as dt
import fnmatch
import html
import math
import re
from collections import Counter
from pathlib import Path
from typing import Any, Iterable

PROGRAMME_URL = "https://www.medeltidsveckan.se/programme/"

CATEGORY_DEFAULT_MINUTES = {
    "Workshop": 90,
    "Föredrag": 60,
    "Guidad visning": 60,
    "Konsert": 60,
    "Teater": 45,
    "Performance": 45,
    "Eldshow": 45,
    "Strid": 45,
    "Parad": 60,
    "Övrigt": 60,
    "Marknad": 60,
    "Festival": 60,
    "Krog": 60,
    "Uppvisningsläger": 120,
}
DEFAULT_DURATION_MINUTES = 60

# A stable colour per category, reused by the HTML grid and the Excel sheets.
CATEGORY_COLORS = {
    "Workshop": "5B8C5A",
    "Föredrag": "5C7CA8",
    "Guidad visning": "4F9D9D",
    "Konsert": "8E6BA8",
    "Teater": "B5793A",
    "Performance": "C0708A",
    "Eldshow": "C0563A",
    "Strid": "8A6D3B",
    "Parad": "A88B2F",
    "Uppvisningsläger": "6E8B3D",
    "Inofficiellt": "9B2D8F",
    "Övrigt": "6B7280",
}
DEFAULT_CATEGORY_COLOR = "6B7280"

SWEDISH_DAY_TO_EN = {
    "Måndag": "Monday",
    "Tisdag": "Tuesday",
    "Onsdag": "Wednesday",
    "Torsdag": "Thursday",
    "Fredag": "Friday",
    "Lördag": "Saturday",
    "Söndag": "Sunday",
}
EN_TO_SWEDISH = {en: sv for sv, en in SWEDISH_DAY_TO_EN.items()}

TIME_RE = re.compile(r"(?P<h>\d{1,2}):(?P<m>\d{2})")


# --------------------------------------------------------------------------- #
# Data model
# --------------------------------------------------------------------------- #
@dataclasses.dataclass
class Event:
    date: str
    weekday: str
    start: str
    end: str
    venue: str
    title: str
    organizer: str = ""
    category: str = ""
    source_url: str = PROGRAMME_URL
    status: str = ""
    ticket_url: str = ""
    description: str = ""
    duration_source: str = ""

    @property
    def start_dt(self) -> dt.datetime:
        return parse_datetime(self.date, self.start)

    @property
    def end_dt(self) -> dt.datetime:
        end = parse_datetime(self.date, self.end)
        if end <= self.start_dt:
            end += dt.timedelta(days=1)
        return end

    @property
    def origin(self) -> dt.datetime:
        return dt.datetime.fromisoformat(f"{self.date}T00:00")

    @property
    def start_min(self) -> int:
        """Minutes from the event's own midnight (handles past-midnight ends)."""
        return int((self.start_dt - self.origin).total_seconds() // 60)

    @property
    def end_min(self) -> int:
        return int((self.end_dt - self.origin).total_seconds() // 60)


def parse_datetime(date_s: str, time_s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(f"{date_s}T{time_s}")


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


_BR_RE = re.compile(r"(?i)<br\s*/?>")
_BLOCK_END_RE = re.compile(r"(?i)</(?:p|div|li|h[1-6]|ul|ol|tr|blockquote)>")
_TAG_RE = re.compile(r"<[^>]+>")


def html_to_text(raw: str) -> str:
    """Convert an HTML fragment to readable plain text, preserving line breaks.

    ``<br>`` becomes a single newline and block-closing tags become paragraph
    breaks; remaining tags are stripped and HTML entities decoded. Used for the
    event descriptions fetched from the detail API.
    """
    if not raw:
        return ""
    text = _BR_RE.sub("\n", raw)
    text = _BLOCK_END_RE.sub("\n\n", text)
    text = _TAG_RE.sub("", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t\u00a0]+", " ", text)   # collapse spaces, keep newlines
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def normalize_time(value: Any) -> str | None:
    if value is None:
        return None
    m = TIME_RE.search(str(value))
    if not m:
        return None
    return f"{int(m.group('h')):02d}:{m.group('m')}"


def normalize_date(value: Any) -> str | None:
    if value is None:
        return None
    m = re.search(r"\d{4}-\d{2}-\d{2}", str(value))
    return m.group(0) if m else None


def swedish_weekday(date_s: str) -> str:
    try:
        return EN_TO_SWEDISH.get(dt.date.fromisoformat(date_s).strftime("%A"), "")
    except (ValueError, TypeError):
        return ""


def infer_end(start: str, category: str, default_minutes: int = DEFAULT_DURATION_MINUTES) -> str:
    mins = CATEGORY_DEFAULT_MINUTES.get(category, default_minutes)
    dummy = dt.datetime(2000, 1, 1, int(start[:2]), int(start[3:5])) + dt.timedelta(minutes=mins)
    return dummy.strftime("%H:%M")


def category_color(category: str) -> str:
    return CATEGORY_COLORS.get(category, DEFAULT_CATEGORY_COLOR)


def dedupe(events: list[Event]) -> list[Event]:
    seen: set[tuple] = set()
    out: list[Event] = []
    for e in events:
        key = (e.date, e.start, e.end, e.venue, e.title, e.category)
        if key not in seen:
            out.append(e)
            seen.add(key)
    return out


# --------------------------------------------------------------------------- #
# Title filtering (used by the renderer to hide all-day / recurring events)
# --------------------------------------------------------------------------- #
DEFAULT_EXCLUDE_FILENAME = "exclude_titles.txt"


def _norm_title(s: str) -> str:
    return re.sub(r"\s+", " ", str(s)).strip().casefold()


def _is_comment_line(line: str) -> bool:
    """A line is a comment only when ``#`` stands alone or is followed by space.

    This lets hashtag-style titles such as ``#allakansyiläder Sy dina egna skor!``
    be used as patterns, while ordinary comment lines (``# ...``) still work.
    """
    return line.startswith("#") and (len(line) == 1 or line[1].isspace())


def load_exclude_patterns(path: Path) -> list[str]:
    """Read exclusion patterns from a text file.

    One pattern per line. Blank lines and comment lines are ignored; a line is a
    comment only when ``#`` is alone or followed by whitespace, so titles that
    *are* hashtags (e.g. ``#allakansyiläder ...``) work as patterns. A leading
    ``\\#`` is an explicit escape that always yields a literal ``#``.

    Matching against event titles is case-insensitive; ``*`` and ``?`` work as
    glob wildcards (so ``*marknad*`` matches a substring while a plain title
    matches exactly).
    """
    p = Path(path)
    if not p.exists():
        return []
    patterns: list[str] = []
    for raw in p.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or _is_comment_line(line):
            continue
        if line.startswith("\\#"):
            line = line[1:]  # escaped leading '#'
        patterns.append(line)
    return patterns


def title_matches(title: str, patterns: Iterable[str]) -> str | None:
    """Return the first pattern that matches ``title``, or ``None``."""
    norm = _norm_title(title)
    for pat in patterns:
        if fnmatch.fnmatchcase(norm, _norm_title(pat)):
            return pat
    return None


def filter_events(events: list[Event], patterns: Iterable[str]) -> tuple[list[Event], Counter]:
    """Drop events whose title matches any pattern.

    Returns ``(kept_events, removed_counter)`` where the counter maps each
    pattern to how many events it removed.
    """
    pats = [p for p in patterns if p.strip()]
    if not pats:
        return list(events), Counter()
    kept: list[Event] = []
    removed: Counter = Counter()
    for e in events:
        match = title_matches(e.title, pats)
        if match is None:
            kept.append(e)
        else:
            removed[match] += 1
    return kept, removed


# --------------------------------------------------------------------------- #
# Persistence (the intermediate data file the two scripts share)
# --------------------------------------------------------------------------- #
_FIELDS = [f.name for f in dataclasses.fields(Event)]


def _event_from_mapping(row: dict[str, Any]) -> Event:
    return Event(**{k: ("" if row.get(k) is None else str(row.get(k, ""))) for k in _FIELDS})


def save_events_json(events: list[Event], path: Path) -> None:
    import json

    path.parent.mkdir(parents=True, exist_ok=True)
    data = [dataclasses.asdict(e) for e in sorted(events, key=lambda x: (x.date, x.start, x.venue, x.title))]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def load_events_json(path: Path) -> list[Event]:
    import json

    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return [_event_from_mapping(row) for row in data]


def save_events_csv(events: list[Event], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=_FIELDS)
        w.writeheader()
        for e in sorted(events, key=lambda x: (x.date, x.start, x.venue, x.title)):
            w.writerow(dataclasses.asdict(e))


def load_events_csv(path: Path) -> list[Event]:
    with Path(path).open(encoding="utf-8-sig") as f:
        return [_event_from_mapping(row) for row in csv.DictReader(f)]


def load_events(path: Path) -> list[Event]:
    """Load events from a ``.json`` or ``.csv`` file (chosen by suffix)."""
    path = Path(path)
    if path.suffix.lower() == ".csv":
        return load_events_csv(path)
    return load_events_json(path)


# --------------------------------------------------------------------------- #
# Timeline lane layout
# --------------------------------------------------------------------------- #
@dataclasses.dataclass
class Placement:
    """An event positioned within a venue column.

    ``lane`` is the 0-based sub-column inside the venue and ``span`` is how many
    lanes it occupies (events with no concurrent neighbour widen to fill the
    venue). ``row_start``/``row_end`` are inclusive/exclusive base-unit indices
    on the day's time axis.
    """

    event: Event
    lane: int
    span: int
    row_start: int
    row_end: int


@dataclasses.dataclass
class VenueLayout:
    venue: str
    lane_count: int
    placements: list[Placement]


@dataclasses.dataclass
class DayLayout:
    date: str
    weekday: str
    day_start_min: int
    day_end_min: int
    base_minutes: int
    slot_minutes: int
    venues: list[VenueLayout]

    @property
    def rows(self) -> int:
        return (self.day_end_min - self.day_start_min) // self.base_minutes

    @property
    def rows_per_slot(self) -> int:
        return self.slot_minutes // self.base_minutes

    def slot_ticks(self) -> list[tuple[int, int]]:
        """Yield ``(row_index, minute_of_day)`` for each slot label line."""
        ticks = []
        m = self.day_start_min
        while m <= self.day_end_min:
            ticks.append(((m - self.day_start_min) // self.base_minutes, m))
            m += self.slot_minutes
        return ticks


def _floor_to(value: int, step: int) -> int:
    return value - (value % step)


def _ceil_to(value: int, step: int) -> int:
    rem = value % step
    return value if rem == 0 else value + (step - rem)


def _layout_intervals(intervals: list[tuple[int, int, Any]]) -> tuple[int, list[tuple[Any, int, int]]]:
    """Assign lanes to a set of ``(start, end, payload)`` intervals.

    Returns ``(lane_count, [(payload, lane, span)])``. Non-overlapping intervals
    reuse lanes; an interval widens (``span > 1``) to fill free lanes to its
    right so a lone event occupies the whole venue width.
    """
    if not intervals:
        return 0, []

    order = sorted(range(len(intervals)), key=lambda i: (intervals[i][0], intervals[i][1]))

    # Split into clusters of transitively-overlapping intervals.
    clusters: list[list[int]] = []
    current: list[int] = []
    cluster_end: int | None = None
    for idx in order:
        s, e, _ = intervals[idx]
        if current and cluster_end is not None and s >= cluster_end:
            clusters.append(current)
            current = []
            cluster_end = None
        current.append(idx)
        cluster_end = e if cluster_end is None else max(cluster_end, e)
    if current:
        clusters.append(current)

    placements: list[tuple[int, int, int, int]] = []  # (idx, lane, span, cluster_cols)
    max_cols = 0
    for cluster in clusters:
        col_end: list[int] = []        # last end time per column
        col_items: list[list[int]] = []  # interval indices per column
        lane_of: dict[int, int] = {}
        for idx in cluster:
            s, e, _ = intervals[idx]
            lane = None
            for c in range(len(col_end)):
                if col_end[c] <= s:
                    lane = c
                    break
            if lane is None:
                lane = len(col_end)
                col_end.append(e)
                col_items.append([idx])
            else:
                col_end[lane] = e
                col_items[lane].append(idx)
            lane_of[idx] = lane
        ncol = len(col_end)
        max_cols = max(max_cols, ncol)
        for idx in cluster:
            s, e, _ = intervals[idx]
            lane = lane_of[idx]
            span = 1
            for c in range(lane + 1, ncol):
                blocked = any(not (intervals[j][1] <= s or intervals[j][0] >= e) for j in col_items[c])
                if blocked:
                    break
                span += 1
            placements.append((idx, lane, span, ncol))

    result: list[tuple[Any, int, int]] = []
    for idx, lane, span, ncol in placements:
        # Reaching the cluster's right edge: extend to the venue's full width.
        if lane + span == ncol and ncol < max_cols:
            span = max_cols - lane
        result.append((intervals[idx][2], lane, span))
    return max_cols, result


def _compute_base_minutes(offsets: Iterable[int], slot_minutes: int) -> int:
    base = slot_minutes
    for off in offsets:
        if off > 0:
            base = math.gcd(base, off)
    return base or slot_minutes


def build_day_layout(date_s: str, day_events: list[Event], slot_minutes: int) -> DayLayout:
    weekday = day_events[0].weekday or swedish_weekday(date_s)
    starts = [e.start_min for e in day_events]
    ends = [e.end_min for e in day_events]
    day_start = _floor_to(min(starts), slot_minutes)
    day_end = max(_ceil_to(max(ends), slot_minutes), day_start + slot_minutes)

    offsets: list[int] = [day_end - day_start]
    for e in day_events:
        offsets.append(e.start_min - day_start)
        offsets.append(e.end_min - day_start)
    base = _compute_base_minutes(offsets, slot_minutes)

    venues_order = sorted({e.venue for e in day_events}, key=lambda v: (v == "Okänd plats", v.lower()))
    venue_layouts: list[VenueLayout] = []
    for venue in venues_order:
        items = [(e.start_min, e.end_min, e) for e in day_events if e.venue == venue]
        lane_count, placed = _layout_intervals(items)
        placements = []
        for event, lane, span in placed:
            row_start = (event.start_min - day_start) // base
            row_end = (event.end_min - day_start) // base
            placements.append(Placement(event, lane, span, row_start, max(row_end, row_start + 1)))
        placements.sort(key=lambda p: (p.row_start, p.lane))
        venue_layouts.append(VenueLayout(venue, max(lane_count, 1), placements))

    return DayLayout(date_s, weekday, day_start, day_end, base, slot_minutes, venue_layouts)


def minutes_to_hhmm(minutes: int) -> str:
    minutes %= 24 * 60
    return f"{minutes // 60:02d}:{minutes % 60:02d}"
