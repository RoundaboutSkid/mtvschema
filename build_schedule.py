#!/usr/bin/env python3
"""
Build the Medeltidsveckan timetable UI from the fetched data file.

Reads ``medeltidsveckan_events.json`` (or a ``.csv``) produced by
``fetch_programme.py`` and renders:

- ``medeltidsveckan_schema.html`` – an interactive day-by-day timeline.
- ``medeltidsveckan_schema.xlsx`` – the same layout as an Excel workbook.

The timeline is a CSS grid per day. Each event is placed with
``grid-row: start / end`` so a multi-slot event is **one continuous block**
instead of being repeated per row, and events that overlap at the *same venue*
are split into side-by-side **lanes**.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
from collections import defaultdict
from pathlib import Path

from medeltidsveckan_common import (
    DEFAULT_CATEGORY_COLOR,
    DEFAULT_EXCLUDE_FILENAME,
    DayLayout,
    Event,
    Placement,
    build_day_layout,
    category_color,
    dedupe,
    filter_events,
    load_events,
    load_exclude_patterns,
    minutes_to_hhmm,
)

try:
    import openpyxl
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
except ImportError:  # pragma: no cover
    openpyxl = None


# --------------------------------------------------------------------------- #
# HTML  (calendar-style timeline with client-side filtering)
# --------------------------------------------------------------------------- #
PX_PER_MIN = 1.3          # vertical scale: 1 minute -> px
NO_CATEGORY = "__none__"  # sentinel for events without a category
CONFIG_FILENAME = "medeltidsveckan_config.json"  # persists e.g. the subscription endpoint

# Ticket icon (body + torn stub) used for the "bought ticket" toggle.
TICKET_SVG = (
    "<svg class='tix' viewBox='0 0 24 24' aria-hidden='true'>"
    "<rect x='3' y='6' width='13' height='12' rx='2.5'/>"
    "<rect x='18' y='6' width='3' height='12' rx='1.5'/>"
    "</svg>"
)


def event_dom_id(e: Event) -> str:
    """Stable client-side id for an event.

    Must match the ``data-id`` attribute used in the HTML so that the browser,
    the print/ICS code and the subscription Worker all agree on the same key.
    """
    return hashlib.md5(
        f"{e.date}|{e.start}|{e.end}|{e.venue}|{e.title}|{e.organizer}".encode("utf-8")
    ).hexdigest()[:12]

PAGE_CSS = """
:root {
  --bg:#faf7f1; --ink:#2a2018; --muted:#6b5d4f; --line:#e3d8c6; --line2:#cdbfa8;
  --axis-w:58px; --head-h:48px; --header-bg:#5c2c14; --chip:#fff;
  --board-max-h:calc(100vh - 200px); --board-pad:10px;
}
* { box-sizing:border-box; }
body { font-family:system-ui,-apple-system,"Segoe UI",sans-serif; margin:0;
  background:var(--bg); color:var(--ink); }
header.top { padding:18px 24px 6px; }
header.top h1 { margin:0 0 4px; }
header.top p { margin:0; color:var(--muted); max-width:72ch; font-size:.92rem; }

nav.days { position:sticky; top:0; z-index:30; display:flex; flex-wrap:wrap; gap:6px;
  padding:10px 24px; background:rgba(250,247,241,.95); backdrop-filter:blur(6px);
  border-bottom:1px solid var(--line); }
nav.days a { text-decoration:none; font-weight:600; font-size:.85rem; padding:4px 10px;
  border-radius:999px; color:var(--header-bg); border:1px solid var(--line); background:#fff; }
nav.days a:hover { background:var(--header-bg); color:#fff; }
nav.days a.empty { opacity:.32; pointer-events:none; }

.toolbar { position:sticky; top:43px; z-index:29; display:flex; flex-wrap:wrap;
  align-items:center; gap:10px; padding:10px 24px; background:rgba(250,247,241,.97);
  backdrop-filter:blur(6px); border-bottom:1px solid var(--line); }
.toolbar input[type=search], .toolbar input.vfilter {
  font:inherit; padding:6px 10px; border:1px solid var(--line2); border-radius:8px;
  background:#fff; min-width:220px; }
.filtermenu { position:relative; }
.filtermenu > summary { list-style:none; cursor:pointer; font-size:.8rem; font-weight:600;
  padding:6px 12px; border:1px solid var(--line2); border-radius:8px; background:#fff; }
.filtermenu > summary::-webkit-details-marker { display:none; }
.filterpanel { position:absolute; z-index:40; margin-top:6px; width:300px; max-height:60vh;
  overflow:auto; background:#fff; border:1px solid var(--line2); border-radius:10px;
  box-shadow:0 8px 24px rgba(0,0,0,.18); padding:10px; }
.filtertools { display:flex; gap:6px; margin-bottom:8px; }
.filtertools button { font:inherit; font-size:.78rem; padding:4px 8px; border:1px solid var(--line2);
  border-radius:7px; background:#fff; cursor:pointer; }
.filterlist label { display:flex; align-items:center; gap:8px; padding:3px 2px; font-size:.85rem; }
.filterlist i { width:11px; height:11px; border-radius:3px; display:inline-block; flex:0 0 auto; }
.count { color:var(--muted); font-size:.82rem; margin-left:auto; }
button.reset { font:inherit; font-size:.8rem; font-weight:600; padding:6px 12px;
  border:1px solid var(--line2); border-radius:8px; background:#fff; cursor:pointer; }
.favtoggle { display:inline-flex; align-items:center; gap:6px; font-size:.8rem; font-weight:600;
  padding:6px 12px; border:1px solid var(--line2); border-radius:8px; background:#fff; cursor:pointer; }
.favtoggle input { accent-color:#d99a00; margin:0; }

section.day { padding:16px 24px 34px; }
section.day h2 { margin:0 0 10px; text-transform:capitalize; }
section.day.empty { display:none; }

.board-scroll { overflow:auto; max-height:var(--board-max-h); min-height:160px;
  overscroll-behavior:contain; border:1px solid var(--line); border-radius:10px; background:#fff; }
.board { display:flex; align-items:stretch; min-width:max-content; }
.axis-col { position:sticky; left:0; z-index:12; flex:0 0 var(--axis-w); background:#fff;
  border-right:1px solid var(--line); }
.axis-head { height:var(--head-h); position:sticky; top:0; z-index:13; background:var(--header-bg);
  color:#fff; font-weight:700; display:flex; align-items:center; justify-content:center; }
.axis-body { position:relative; overflow:hidden; }
.tick { position:absolute; right:6px; transform:translateY(-50%); font-size:.7rem;
  font-weight:700; color:var(--muted); white-space:nowrap; }
.tick.hour { color:var(--ink); }

.venue-col { flex:1 1 0; display:flex; flex-direction:column;
  border-right:1px solid var(--line); }
.venue-col.hidden { display:none; }
.venue-head { height:var(--head-h); position:sticky; top:0; z-index:8; background:var(--header-bg);
  color:#fff; font-weight:700; font-size:.82rem; line-height:1.1; text-align:center;
  display:flex; align-items:center; justify-content:center; padding:4px 8px; overflow:hidden;
  border-left:1px solid rgba(255,255,255,.16); }
.track { position:relative; flex:1 0 auto; overflow:hidden; }
.axis-inner { position:relative; transform:translateY(calc(var(--board-pad) - var(--off, 0px)));
  background-image:repeating-linear-gradient(to bottom,
    var(--line) 0, var(--line) 1px, transparent 1px, transparent var(--slot-px)); }
.track-inner { position:absolute; top:0; left:0; right:0;
  transform:translateY(calc(var(--board-pad) - var(--off, 0px)));
  background-image:repeating-linear-gradient(to bottom,
    var(--line) 0, var(--line) 1px, transparent 1px, transparent var(--slot-px)); }

.event { position:absolute; overflow:hidden; border-radius:6px; color:#fff;
  padding:3px 6px; font-size:.75rem; line-height:1.16; box-shadow:0 1px 2px rgba(0,0,0,.22);
  border:1px solid rgba(0,0,0,.08); cursor:pointer; transition:filter .1s, box-shadow .1s; }
.event:hover { filter:brightness(1.07); box-shadow:0 3px 8px rgba(0,0,0,.32); z-index:6; }
.event.hidden { display:none; }
.event .t { font-weight:700; font-size:.69rem; opacity:.92; }
.event .ttl { font-weight:700; display:block; }
.event .org { opacity:.92; display:block; font-size:.7rem; }
.event .meta { margin-top:2px; display:flex; flex-wrap:wrap; gap:4px; }
.event .badge { padding:0 6px; border-radius:999px; background:rgba(255,255,255,.24); font-size:.66rem; }
.event a.badge.ticket { color:#fff; text-decoration:none; cursor:pointer;
  background:rgba(255,255,255,.34); font-weight:700; }
.event a.badge.ticket:hover { background:rgba(255,255,255,.6); }
.event.needs-ticket::before { content:''; position:absolute; left:0; top:0; bottom:0; width:4px;
  background:#e11d2a; border-radius:6px 0 0 6px; z-index:3; }
.event-actions { position:absolute; top:2px; right:3px; display:flex; align-items:center;
  gap:3px; z-index:5; }
.event-actions > * { width:16px; height:16px; border-radius:50%; display:flex; line-height:1;
  align-items:center; justify-content:center; font-size:.72rem; font-style:normal; }
.event-actions .act { border:none; padding:0; cursor:pointer; color:#fff;
  background:rgba(0,0,0,.3); opacity:.45; transition:opacity .1s, background .1s, color .1s; }
.event:hover .event-actions .act { opacity:.8; }
.event-actions .act:hover { opacity:1 !important; background:rgba(0,0,0,.5); }
.event.is-fav .act.fav { opacity:1; color:#ffd23f; background:rgba(0,0,0,.36); }
.event.is-bought .act.bought { opacity:1; color:#4ee48d; background:rgba(0,0,0,.36); }
.event .info { background:rgba(0,0,0,.22); color:#fff; font-weight:700; opacity:.7; pointer-events:none; }
.event:hover .info { opacity:1; background:rgba(0,0,0,.34); }
.event-actions .act.hide:hover { opacity:1 !important; background:#b3261e; }
.event.is-hidden { opacity:.45; filter:grayscale(.65); }
.event.is-hidden .ttl { text-decoration:line-through; }
.event.is-hidden .act.hide { opacity:1; color:#fff; background:rgba(0,0,0,.42); }
.event .warn { display:none; }
.event.needs-ticket .warn { display:flex; background:#e11d2a; color:#fff; font-weight:800;
  font-size:.82rem; box-shadow:0 0 0 2px rgba(255,255,255,.55); }
.event-actions .act svg.tix { width:11px; height:11px; display:block; fill:currentColor; }
.event.short .event-actions .act svg.tix { width:9px; height:9px; }
.event.short .event-actions > * { width:14px; height:14px; font-size:.62rem; }
.event.short { padding:1px 6px; }
.event.short .org, .event.short .meta { display:none; }
.event.short .ttl { font-size:.7rem; }
.nohits { padding:14px 4px; color:var(--muted); font-style:italic; }

.modal-overlay { position:fixed; inset:0; z-index:50; display:flex; align-items:center;
  justify-content:center; padding:24px; background:rgba(20,12,6,.55); backdrop-filter:blur(2px); }
.modal-overlay[hidden] { display:none; }
.modal { background:#fff; color:var(--ink); max-width:560px; width:100%; max-height:85vh;
  overflow:auto; border-radius:14px; box-shadow:0 18px 50px rgba(0,0,0,.4);
  border-top:6px solid var(--header-bg); padding:22px 24px 24px; position:relative; }
.modal-close { position:absolute; top:8px; right:12px; border:none; background:none;
  font-size:1.7rem; line-height:1; cursor:pointer; color:var(--muted); }
.modal-close:hover { color:var(--ink); }
.modal h3 { margin:0 24px 6px 0; font-size:1.25rem; }
.modal .m-meta { color:var(--muted); font-size:.9rem; }
.modal .m-badges { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0 14px; }
.modal .m-badges .badge { padding:2px 10px; border-radius:999px; color:#fff;
  font-size:.78rem; font-weight:600; }
.modal .m-badges a.badge { text-decoration:none; cursor:pointer; }
.modal .m-badges a.badge:hover { filter:brightness(1.12); text-decoration:underline; }
.modal .m-desc { font-size:.95rem; line-height:1.5; }
.modal .m-desc p { margin:0 0 .7em; }
.modal .m-desc p.empty { color:var(--muted); font-style:italic; }
.modal a.m-ticket { display:inline-block; margin-top:14px; padding:10px 18px; border-radius:10px;
  background:var(--header-bg); color:#fff; font-weight:700; text-decoration:none; }
.modal a.m-ticket:hover { background:#46210f; }
.modal a.m-ticket[hidden] { display:none; }
.modal .m-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:16px; }
.modal .m-btn { font:inherit; font-size:.9rem; font-weight:700; padding:9px 16px; border-radius:10px;
  border:1px solid var(--line2); background:#fff; color:var(--ink); cursor:pointer;
  display:inline-flex; align-items:center; gap:.4em; }
.modal .m-btn:hover { border-color:var(--header-bg); }
.modal .m-btn svg.tix { width:1.15em; height:1.15em; fill:currentColor; }
.modal .m-btn.fav.on { background:#fff7e0; border-color:#e6b400; color:#7a5b00; }
.modal .m-btn.bought.on { background:#e8f8ee; border-color:#37b86e; color:#1b6b3c; }
.modal .m-btn.hide.on { background:#fdecea; border-color:#e0796f; color:#8a2b1f; }
#hidedlg.modal-overlay { z-index:80; }
.modal.hidedlg { max-width:430px; }
.modal.hidedlg .hd-msg { color:var(--ink); font-size:.95rem; line-height:1.5; margin:8px 0 2px; }
.modal.hidedlg .hd-msg b { font-weight:700; }
.modal.hidedlg .m-actions { margin-top:18px; }
.modal .m-btn.danger { background:#b3261e; border-color:#b3261e; color:#fff; }
.modal .m-btn.danger:hover { background:#8a1c16; border-color:#8a1c16; }
.modal .m-btn[hidden] { display:none; }
.modal a.m-btn { text-decoration:none; }
.modal.sub .sub-url { display:flex; gap:8px; margin:14px 0 4px; }
.modal.sub .sub-url input { flex:1; min-width:0; font:inherit; font-size:.82rem;
  padding:8px 10px; border:1px solid var(--line2); border-radius:8px;
  background:#faf7f2; color:var(--ink); }
.modal .m-btn.primary { background:var(--header-bg); color:#fff; border-color:var(--header-bg); }
.modal .m-btn.primary:hover { background:#46210f; border-color:#46210f; }
.modal.sub .sub-status { font-size:.85rem; color:var(--muted); min-height:1.2em; margin:4px 0 2px; }
.modal.sub .sub-status.ok { color:#1b6b3c; }
.modal.sub .sub-status.warn { color:#b00020; }
.modal.sub .sub-help { font-size:.84rem; color:var(--muted); line-height:1.55;
  margin-top:16px; border-top:1px solid var(--line2); padding-top:12px; }
.modal.sub .sub-help ol { margin:.5em 0 0; padding-left:1.25em; }
.modal.sub .sub-help .sub-note { display:block; margin-top:.6em; font-style:italic; }

.printview { position:fixed; inset:0; z-index:60; background:#fff; color:#1a1a1a;
  overflow:auto; padding:32px 40px 60px; }
.printview[hidden] { display:none; }
.printview .pv-bar { display:flex; flex-wrap:wrap; align-items:center; gap:12px;
  margin-bottom:18px; }
.printview .pv-bar h2 { margin:0; font-size:1.4rem; }
.printview .pv-bar .pv-sub { color:#555; font-size:.9rem; }
.printview .pv-bar .pv-actions { margin-left:auto; display:flex; gap:8px; }
.printview .pv-btn { font:inherit; font-size:.85rem; font-weight:700; padding:8px 14px;
  border-radius:8px; border:1px solid #b9aa90; background:#fff; cursor:pointer; }
.printview .pv-btn.primary { background:var(--header-bg); color:#fff; border-color:var(--header-bg); }
.pv-day { break-inside:avoid; margin:0 0 18px; }
.pv-day h3 { margin:0 0 6px; padding-bottom:4px; font-size:1.05rem;
  border-bottom:2px solid #1a1a1a; text-transform:capitalize; }
.pv-row { display:grid; grid-template-columns:96px 1fr auto; gap:10px; align-items:baseline;
  padding:5px 0; border-bottom:1px solid #ddd; break-inside:avoid; }
.pv-row .pv-time { font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap; }
.pv-row .pv-title { font-weight:700; }
.pv-row .pv-where { color:#444; font-size:.9rem; }
.pv-row .pv-tag { font-size:.78rem; font-weight:700; padding:1px 8px; border-radius:999px;
  border:1px solid #999; white-space:nowrap; }
.pv-row .pv-tag.need { color:#b10018; border-color:#b10018; }
.pv-row .pv-tag.have { color:#176b39; border-color:#176b39; }
.pv-empty { color:#666; font-style:italic; }
.pv-foot { margin-top:24px; color:#777; font-size:.8rem; }

@media print {
  body.printing > *:not(.printview) { display:none !important; }
  .printview { position:static; padding:0; }
  .printview .pv-actions { display:none !important; }
  @page { margin:16mm; }
}
@media (max-width:640px){ :root{ --axis-w:48px; } }
"""

SCRIPT_JS = r"""
(function () {
  const q = document.getElementById('q');
  const catBoxes = Array.from(document.querySelectorAll('.catbox'));
  const venueBoxes = Array.from(document.querySelectorAll('.venuebox'));
  const countEl = document.getElementById('count');
  const favOnly = document.getElementById('favOnly');
  const showHidden = document.getElementById('showHidden');
  const hiddenCountEl = document.getElementById('hiddenCount');
  const unhideAll = document.getElementById('unhideAll');
  const events = Array.from(document.querySelectorAll('.event'));
  const total = events.length;

  const activeCats = new Set(catBoxes.map(b => b.value));
  const activeVenues = new Set(venueBoxes.map(b => b.value));

  // Shrink each day's timeline to the visible time span (great when filtering favourites).
  function adaptDays() {
    document.querySelectorAll('.board').forEach(board => {
      const dayStart = +board.dataset.dayStart;
      const dayEnd = +board.dataset.dayEnd;
      const slot = +board.dataset.slot || 30;
      const px = parseFloat(board.dataset.px) || 1;
      let lo = Infinity, hi = -Infinity;
      board.querySelectorAll('.event').forEach(ev => {
        if (ev.classList.contains('hidden')) return;
        const s = +ev.dataset.s, e = +ev.dataset.e;
        if (s < lo) lo = s;
        if (e > hi) hi = e;
      });
      let off, vis;
      if (lo === Infinity) {
        off = 0; vis = (dayEnd - dayStart) * px;
      } else {
        const startSnap = dayStart + Math.floor((lo - dayStart) / slot) * slot;
        const endSnap = dayStart + Math.ceil((hi - dayStart) / slot) * slot;
        off = (startSnap - dayStart) * px;
        vis = Math.max((endSnap - startSnap) * px, slot * px);
      }
      board.style.setProperty('--off', off + 'px');
      board.style.setProperty('--vis', vis + 'px');
    });
  }

  function apply() {
    const term = (q.value || '').trim().toLowerCase();
    const onlyFav = favOnly && favOnly.checked;
    const revealHidden = showHidden && showHidden.checked;
    let visible = 0, hiddenTotal = 0;
    for (const el of events) {
      const isHid = window.MV && window.MV.isHiddenEl(el);
      if (isHid) hiddenTotal++;
      const okCat = activeCats.has(el.dataset.cat);
      const okVenue = activeVenues.has(el.dataset.venue);
      const okText = !term || el.dataset.search.indexOf(term) !== -1;
      const okFav = !onlyFav || (window.MV && window.MV.isFav(el.dataset.id));
      const okHide = !isHid || revealHidden;
      const show = okCat && okVenue && okText && okFav && okHide;
      el.classList.toggle('hidden', !show);
      if (show) visible++;
    }
    if (hiddenCountEl) hiddenCountEl.textContent = hiddenTotal;
    if (unhideAll) unhideAll.style.display = hiddenTotal ? '' : 'none';
    // Hide venue columns with no visible events (or unchecked venue).
    document.querySelectorAll('.venue-col').forEach(col => {
      const venueOn = activeVenues.has(col.dataset.venue);
      const hasVisible = venueOn && col.querySelector('.event:not(.hidden)') !== null;
      col.classList.toggle('hidden', !hasVisible);
    });
    // Hide days with no visible columns; dim their nav links.
    document.querySelectorAll('section.day').forEach(day => {
      const any = day.querySelector('.venue-col:not(.hidden)') !== null;
      day.classList.toggle('empty', !any);
      const link = document.querySelector('nav.days a[href="#' + day.id + '"]');
      if (link) link.classList.toggle('empty', !any);
    });
    adaptDays();
    countEl.textContent = 'Visar ' + visible + ' av ' + total + ' programpunkter';
  }

  q.addEventListener('input', apply);
  if (favOnly) favOnly.addEventListener('change', apply);
  if (showHidden) showHidden.addEventListener('change', apply);
  if (unhideAll) unhideAll.addEventListener('click', () => {
    if (window.MV) window.MV.clearHidden();
    if (showHidden) showHidden.checked = false;
    apply();
  });
  catBoxes.forEach(b => b.addEventListener('change', () => {
    if (b.checked) activeCats.add(b.value); else activeCats.delete(b.value);
    apply();
  }));
  venueBoxes.forEach(b => b.addEventListener('change', () => {
    if (b.checked) activeVenues.add(b.value); else activeVenues.delete(b.value);
    apply();
  }));

  function wireMenu(boxes, activeSet, filterId, allId, noneId) {
    const filt = document.getElementById(filterId);
    if (filt) filt.addEventListener('input', () => {
      const t = filt.value.trim().toLowerCase();
      boxes.forEach(b => {
        const txt = (b.parentElement.textContent || '').trim().toLowerCase();
        b.closest('label').style.display = (!t || txt.indexOf(t) !== -1) ? '' : 'none';
      });
    });
    const setAll = on => { boxes.forEach(b => {
      if (b.closest('label').style.display === 'none') return;
      b.checked = on; if (on) activeSet.add(b.value); else activeSet.delete(b.value);
    }); apply(); };
    const a = document.getElementById(allId), n = document.getElementById(noneId);
    if (a) a.addEventListener('click', e => { e.preventDefault(); setAll(true); });
    if (n) n.addEventListener('click', e => { e.preventDefault(); setAll(false); });
    return filt;
  }
  const cfilter = wireMenu(catBoxes, activeCats, 'catFilter', 'catAll', 'catNone');
  const vfilter = wireMenu(venueBoxes, activeVenues, 'venueFilter', 'venueAll', 'venueNone');

  document.getElementById('reset').addEventListener('click', () => {
    q.value = '';
    catBoxes.forEach(b => { b.checked = true; activeCats.add(b.value); b.closest('label').style.display = ''; });
    venueBoxes.forEach(b => { b.checked = true; activeVenues.add(b.value); b.closest('label').style.display = ''; });
    if (cfilter) cfilter.value = '';
    if (vfilter) vfilter.value = '';
    if (favOnly) favOnly.checked = false;
    if (showHidden) showHidden.checked = false;
    apply();
  });

  if (window.MV) window.MV.onChange(apply);
  apply();
})();
"""

MODAL_HTML = (
    "<div id='modal' class='modal-overlay' hidden>"
    "<div class='modal' role='dialog' aria-modal='true' aria-labelledby='m-title'>"
    "<button class='modal-close' id='m-close' aria-label='Stäng' title='Stäng'>×</button>"
    "<h3 id='m-title'></h3>"
    "<div class='m-meta' id='m-meta'></div>"
    "<div class='m-badges' id='m-badges'></div>"
    "<div class='m-desc' id='m-desc'></div>"
    "<div class='m-actions'>"
    "<button type='button' class='m-btn fav' id='m-fav'>\u2606 Favorit</button>"
    "<button type='button' class='m-btn bought' id='m-bought' hidden>Markera biljett som k\u00f6pt</button>"
    "<button type='button' class='m-btn hide' id='m-hide'>\u2715 D\u00f6lj event</button>"
    "</div>"
    "<a class='m-ticket' id='m-ticket' target='_blank' rel='noopener' hidden>Köp biljett \u2197</a>"
    "</div></div>"
)

MODAL_JS = r"""
(function () {
  const modal = document.getElementById('modal');
  if (!modal) return;
  const mTitle = document.getElementById('m-title');
  const mMeta = document.getElementById('m-meta');
  const mBadges = document.getElementById('m-badges');
  const mDesc = document.getElementById('m-desc');
  const mTicket = document.getElementById('m-ticket');
  const mFav = document.getElementById('m-fav');
  const mBought = document.getElementById('m-bought');
  const mHide = document.getElementById('m-hide');
  let currentId = null, currentTicketed = false;
  const TICKET_SVG = "<svg class='tix' viewBox='0 0 24 24' aria-hidden='true'><rect x='3' y='6' width='13' height='12' rx='2.5'/><rect x='18' y='6' width='3' height='12' rx='1.5'/></svg>";

  function addBadge(text, color, href) {
    const b = document.createElement(href ? 'a' : 'span');
    b.className = 'badge';
    b.textContent = href ? text + ' \u2197' : text;
    if (color) b.style.background = color;
    if (href) { b.href = href; b.target = '_blank'; b.rel = 'noopener'; }
    mBadges.appendChild(b);
  }

  function refreshActions() {
    if (!window.MV) return;
    const fav = currentId ? window.MV.isFav(currentId) : false;
    const buy = currentId ? window.MV.isBought(currentId) : false;
    mFav.textContent = (fav ? '\u2605' : '\u2606') + ' Favorit';
    mFav.classList.toggle('on', fav);
    mBought.hidden = !currentTicketed;
    mBought.innerHTML = TICKET_SVG + (buy ? ' Biljett k\u00f6pt' : ' Markera biljett som k\u00f6pt');
    mBought.classList.toggle('on', buy);
    const hid = currentId ? window.MV.isHidden(currentId) : false;
    mHide.textContent = hid ? '\u21a9 Visa eventet igen' : '\u2715 D\u00f6lj event';
    mHide.classList.toggle('on', hid);
  }

  function openFor(el) {
    currentId = el.dataset.id || null;
    currentTicketed = !!el.dataset.ticket;
    mTitle.textContent = el.dataset.title || '';
    const meta = [];
    if (el.dataset.time) meta.push(el.dataset.time);
    if (el.dataset.venue) meta.push(el.dataset.venue);
    if (el.dataset.org) meta.push(el.dataset.org);
    mMeta.textContent = meta.join('  \u00b7  ');

    mBadges.textContent = '';
    const cat = el.dataset.cat;
    if (cat && cat !== '__none__') {
      addBadge(cat, el.dataset.color ? '#' + el.dataset.color : null);
    }
    if (el.dataset.status) addBadge(el.dataset.status, '#8a6d3b', el.dataset.ticket || null);

    mDesc.textContent = '';
    const desc = (el.dataset.desc || '').trim();
    if (desc) {
      desc.split(/\n+/).forEach(line => {
        line = line.trim();
        if (!line) return;
        const p = document.createElement('p');
        p.textContent = line;
        mDesc.appendChild(p);
      });
    } else {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'Ingen beskrivning tillgänglig. Kontrollera originalprogrammet.';
      mDesc.appendChild(p);
    }

    if (el.dataset.ticket) { mTicket.href = el.dataset.ticket; mTicket.hidden = false; }
    else { mTicket.removeAttribute('href'); mTicket.hidden = true; }

    refreshActions();
    modal.hidden = false;
  }
  function close() { modal.hidden = true; }

  document.querySelectorAll('.event').forEach(el => {
    el.addEventListener('click', ev => {
      if (ev.target.closest('a') || ev.target.closest('.event-actions')) return;
      openFor(el);
    });
  });
  modal.addEventListener('click', ev => { if (ev.target === modal) close(); });
  document.getElementById('m-close').addEventListener('click', close);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !modal.hidden) close(); });
  mFav.addEventListener('click', () => { if (window.MV && currentId) window.MV.toggleFav(currentId); });
  mBought.addEventListener('click', () => { if (window.MV && currentId) window.MV.toggleBought(currentId); });
  mHide.addEventListener('click', () => {
    if (!window.MV || !currentId) return;
    window.MV.requestHide(currentId, { onHidden: close });
  });
  if (window.MV) window.MV.onChange(refreshActions);
})();
"""

PRINTVIEW_HTML = (
    "<div id='printview' class='printview' hidden>"
    "<div class='pv-bar'>"
    "<div><h2>Mina favoriter \u2013 Medeltidsveckan</h2>"
    "<div class='pv-sub' id='pv-sub'></div></div>"
    "<div class='pv-actions'>"
    "<button type='button' class='pv-btn primary' id='pv-print'>Skriv ut</button>"
    "<button type='button' class='pv-btn' id='pv-close'>St\u00e4ng</button>"
    "</div></div>"
    "<div id='pv-body'></div>"
    "<div class='pv-foot'>Kontrollera biljettkr\u00e4vande punkter mot originalprogrammet f\u00f6re bokning.</div>"
    "</div>"
)

PRINT_JS = r"""
(function () {
  const view = document.getElementById('printview');
  if (!view) return;
  const body = document.getElementById('pv-body');
  const sub = document.getElementById('pv-sub');
  const btn = document.getElementById('printFav');
  const closeBtn = document.getElementById('pv-close');
  const printBtn = document.getElementById('pv-print');
  const WEEKDAYS = ['s\u00f6ndag','m\u00e5ndag','tisdag','onsdag','torsdag','fredag','l\u00f6rdag'];

  function dayHeading(sec) {
    const h = sec.querySelector('h2');
    return h ? h.textContent.trim() : sec.id;
  }

  function collect() {
    const days = [];
    document.querySelectorAll('section.day').forEach(sec => {
      const rows = [];
      sec.querySelectorAll('.event').forEach(el => {
        if (!window.MV || !window.MV.isFav(el.dataset.id)) return;
        rows.push({
          s: +el.dataset.s,
          time: el.dataset.time || '',
          title: el.dataset.title || '',
          venue: el.dataset.venue || '',
          org: el.dataset.org || '',
          ticket: !!el.dataset.ticket,
          bought: window.MV.isBought(el.dataset.id),
        });
      });
      if (rows.length) {
        rows.sort((a, b) => a.s - b.s || a.title.localeCompare(b.title, 'sv'));
        days.push({ heading: dayHeading(sec), rows: rows });
      }
    });
    return days;
  }

  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function render() {
    const days = collect();
    body.textContent = '';
    let total = 0, needing = 0;
    if (!days.length) {
      const p = document.createElement('p');
      p.className = 'pv-empty';
      p.textContent = 'Du har inte markerat n\u00e5gra favoriter \u00e4nnu. St\u00e4ng den h\u00e4r vyn och klicka p\u00e5 stj\u00e4rnan p\u00e5 de event du vill spara.';
      body.appendChild(p);
      sub.textContent = '';
      return;
    }
    const html = [];
    days.forEach(day => {
      html.push("<div class='pv-day'><h3>" + esc(day.heading) + "</h3>");
      day.rows.forEach(r => {
        total++;
        const where = [r.venue, r.org].filter(Boolean).map(esc).join(' \u00b7 ');
        let tag = '';
        if (r.ticket && !r.bought) { tag = "<span class='pv-tag need'>Biljett beh\u00f6vs</span>"; needing++; }
        else if (r.ticket && r.bought) { tag = "<span class='pv-tag have'>Biljett k\u00f6pt</span>"; }
        html.push(
          "<div class='pv-row'><span class='pv-time'>" + esc(r.time) + "</span>" +
          "<span><span class='pv-title'>" + esc(r.title) + "</span>" +
          (where ? "<div class='pv-where'>" + where + "</div>" : "") + "</span>" +
          (tag || "<span></span>") + "</div>"
        );
      });
      html.push("</div>");
    });
    body.innerHTML = html.join('');
    let s = total + (total === 1 ? ' favorit' : ' favoriter') + ' p\u00e5 ' +
      days.length + (days.length === 1 ? ' dag' : ' dagar');
    if (needing) s += ' \u00b7 ' + needing + ' biljett' + (needing === 1 ? '' : 'er') + ' kvar att k\u00f6pa';
    sub.textContent = s;
  }

  function open() { render(); view.hidden = false; document.body.classList.add('printing'); }
  function close() { view.hidden = true; document.body.classList.remove('printing'); }

  if (btn) btn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (printBtn) printBtn.addEventListener('click', () => window.print());
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !view.hidden) close(); });
})();
"""

CALENDAR_JS = r"""
(function () {
  const PRODID = '-//Medeltidsveckan schema//SV';
  const VTIMEZONE = [
    'BEGIN:VTIMEZONE', 'TZID:Europe/Stockholm',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST',
    'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET',
    'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'END:VTIMEZONE'
  ];

  const pad = n => String(n).padStart(2, '0');

  // Wall-clock stamp (Europe/Stockholm). Date.UTC is used purely for date math
  // so day rollover past midnight works; the value is labelled with TZID below.
  function localStamp(dateStr, minutes) {
    const p = dateStr.split('-').map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]) + minutes * 60000);
    return '' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
      'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00';
  }
  function utcStamp(d) {
    return '' + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) +
      'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }
  function esc(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;')
      .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  // Fold content lines at 75 octets (RFC 5545); continuation lines start with a space.
  function fold(line) {
    const enc = new TextEncoder();
    let out = '', cur = '', bytes = 0;
    for (const ch of line) {
      const w = enc.encode(ch).length;
      if (bytes + w > 73) { out += (out ? '\r\n ' : '') + cur; cur = ch; bytes = w; }
      else { cur += ch; bytes += w; }
    }
    return out + (out ? '\r\n ' : '') + cur;
  }

  function collectFavs() {
    const items = [];
    document.querySelectorAll('section.day').forEach(sec => {
      const date = sec.id.replace(/^day-/, '');
      sec.querySelectorAll('.event').forEach(el => {
        if (!window.MV || !window.MV.isFav(el.dataset.id)) return;
        items.push({
          id: el.dataset.id, date: date, s: +el.dataset.s, e: +el.dataset.e,
          title: el.dataset.title || '', venue: el.dataset.venue || '',
          org: el.dataset.org || '', cat: el.dataset.cat || '',
          desc: el.dataset.desc || '', ticket: el.dataset.ticket || '',
          bought: window.MV.isBought(el.dataset.id),
        });
      });
    });
    return items;
  }

  function description(it) {
    const blocks = [];
    if (it.desc) blocks.push(it.desc);
    const meta = [];
    if (it.org) meta.push('Arrangör: ' + it.org);
    if (it.cat && it.cat !== '__none__') meta.push('Kategori: ' + it.cat);
    if (it.ticket) {
      meta.push(it.bought ? 'Biljett: köpt' : 'Biljett: behövs (ej markerad som köpt)');
      meta.push('Köp biljett: ' + it.ticket);
    }
    if (it.cat === 'Inofficiellt')
      meta.push('OBS: plats och sluttid är ungefärliga (inofficiellt program).');
    if (meta.length) { if (blocks.length) blocks.push(''); blocks.push(meta.join('\n')); }
    return blocks.join('\n');
  }

  function build(items) {
    const now = utcStamp(new Date());
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:' + PRODID,
      'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:Medeltidsveckan \u2013 mina favoriter',
      'X-WR-TIMEZONE:Europe/Stockholm'];
    VTIMEZONE.forEach(l => lines.push(l));
    items.forEach(it => {
      const loc = (it.venue && it.venue !== 'Okänd plats') ? it.venue : '';
      lines.push('BEGIN:VEVENT');
      lines.push('UID:mv-' + it.id + '@medeltidsveckan');
      lines.push('DTSTAMP:' + now);
      lines.push('DTSTART;TZID=Europe/Stockholm:' + localStamp(it.date, it.s));
      lines.push('DTEND;TZID=Europe/Stockholm:' + localStamp(it.date, it.e));
      lines.push('SUMMARY:' + esc(it.title));
      if (loc) lines.push('LOCATION:' + esc(loc));
      const desc = description(it);
      if (desc) lines.push('DESCRIPTION:' + esc(desc));
      if (it.ticket) lines.push('URL:' + esc(it.ticket));
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  if (typeof window !== 'undefined') window.MVICS = { build: build };

  const btn = (typeof document !== 'undefined') ? document.getElementById('icsFav') : null;
  if (!btn) return;
  btn.addEventListener('click', () => {
    const items = collectFavs();
    if (!items.length) {
      alert('Du har inte markerat några favoriter ännu. Klicka på stjärnan på de event du vill lägga till i kalendern.');
      return;
    }
    const blob = new Blob([build(items)], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'medeltidsveckan-favoriter.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
})();
"""

SUBSCRIBE_HTML = (
    "<div id='submodal' class='modal-overlay' hidden>"
    "<div class='modal sub' role='dialog' aria-modal='true' aria-labelledby='sub-title'>"
    "<button class='modal-close' id='sub-close' aria-label='Stäng' title='Stäng'>×</button>"
    "<h3 id='sub-title'>Prenumerera på dina favoriter</h3>"
    "<div class='m-meta'>Din kalender hämtar dina favoriter automatiskt och uppdaterar dem "
    "när programmet eller dina val ändras.</div>"
    "<div class='sub-status' id='sub-status'></div>"
    "<div class='sub-url'>"
    "<input id='sub-link' readonly aria-label='Prenumerationslänk'>"
    "<button type='button' class='m-btn' id='sub-copy'>Kopiera</button>"
    "</div>"
    "<div class='m-actions'>"
    "<a class='m-btn primary' id='sub-open' href='#'>Öppna i kalender</a>"
    "</div>"
    "<div class='sub-help'>"
    "<strong>Apple Kalender / Outlook:</strong> klicka <em>Öppna i kalender</em> ovan.<br>"
    "<strong>Google Kalender:</strong> kopiera länken, gå till "
    "<em>Inställningar → Lägg till kalender → Från URL</em> och klistra in den."
    "<ol>"
    "<li>Markera de event du vill ha med stjärnan (★).</li>"
    "<li>Prenumerera en gång – nya favoriter dyker upp automatiskt.</li>"
    "</ol>"
    "<span class='sub-note'>Kalenderappar uppdaterar prenumerationer med några timmars "
    "mellanrum, inte direkt.</span>"
    "</div>"
    "</div></div>"
)

HIDE_DIALOG_HTML = (
    "<div id='hidedlg' class='modal-overlay' hidden>"
    "<div class='modal hidedlg' role='dialog' aria-modal='true' aria-labelledby='hd-title'>"
    "<button class='modal-close' id='hd-x' aria-label='Avbryt' title='Avbryt'>×</button>"
    "<h3 id='hd-title'>Dölj event</h3>"
    "<div class='hd-msg' id='hd-msg'></div>"
    "<div class='m-actions'>"
    "<button type='button' class='m-btn danger' id='hd-all'></button>"
    "<button type='button' class='m-btn' id='hd-one'>Bara den här</button>"
    "<button type='button' class='m-btn' id='hd-cancel'>Avbryt</button>"
    "</div>"
    "</div></div>"
)

HIDE_JS = r"""
(function () {
  const dlg = document.getElementById('hidedlg');
  if (!dlg) return;
  const titleEl = document.getElementById('hd-title');
  const msgEl = document.getElementById('hd-msg');
  const allBtn = document.getElementById('hd-all');
  const oneBtn = document.getElementById('hd-one');
  const cancelBtn = document.getElementById('hd-cancel');
  const xBtn = document.getElementById('hd-x');
  let cb = {};
  function close() { dlg.hidden = true; cb = {}; }
  function fire(name) { const fn = cb[name]; close(); if (fn) fn(); }
  function open(opts) {
    cb = opts || {};
    const n = opts.count || 1;
    const t = opts.title || 'det här eventet';
    if (opts.mode === 'restore') {
      titleEl.textContent = 'Visa dolt event igen';
      msgEl.innerHTML = '”<b class="hd-t"></b>” är dold på <b>' + n + '</b> platser i schemat.';
      allBtn.textContent = 'Visa alla ' + n;
      allBtn.classList.remove('danger');
      oneBtn.hidden = true;
    } else {
      titleEl.textContent = 'Dölj event';
      msgEl.innerHTML = '”<b class="hd-t"></b>” förekommer <b>' + n +
        '</b> gånger. Vill du dölja alla, eller bara den här?';
      allBtn.textContent = 'Dölj alla ' + n;
      allBtn.classList.add('danger');
      oneBtn.hidden = false;
    }
    msgEl.querySelector('.hd-t').textContent = t;
    dlg.hidden = false;
    allBtn.focus();
  }
  allBtn.addEventListener('click', () => fire('onAll'));
  oneBtn.addEventListener('click', () => fire('onOne'));
  cancelBtn.addEventListener('click', () => fire('onCancel'));
  if (xBtn) xBtn.addEventListener('click', () => fire('onCancel'));
  dlg.addEventListener('click', ev => { if (ev.target === dlg) fire('onCancel'); });
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !dlg.hidden) fire('onCancel'); });
  window.MVHIDE = { open: open, close: close };
})();
"""

SYNC_JS = r"""
(function () {
  const cfg = (typeof window !== 'undefined' && window.MV_CFG) || {};
  const endpoint = String(cfg.icsEndpoint || '').replace(/\/+$/, '');
  const btn = document.getElementById('subFav');
  if (!endpoint || !window.MV) { if (btn) btn.hidden = true; return; }

  const UID_KEY = 'mv_uid_v1';
  function getUid() {
    let v = '';
    try { v = localStorage.getItem(UID_KEY) || ''; } catch (e) {}
    if (!v) {
      v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : 'u-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(UID_KEY, v); } catch (e) {}
    }
    return v;
  }
  const U = getUid();
  const subUrl = endpoint + '/fav.ics?u=' + encodeURIComponent(U);
  const webcal = subUrl.replace(/^https?:/, 'webcal:');

  function idsWhere(pred) {
    const ids = [];
    document.querySelectorAll('.event').forEach(el => {
      if (pred(el.dataset.id)) ids.push(el.dataset.id);
    });
    return ids;
  }
  const favIds = () => idsWhere(id => window.MV.isFav(id));
  const boughtIds = () => idsWhere(id => window.MV.isBought(id));

  const statusEl = document.getElementById('sub-status');
  function setStatus(msg, cls) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    statusEl.className = 'sub-status' + (cls ? ' ' + cls : '');
  }

  let timer = null, lastSent = '';
  const payload = () => JSON.stringify({ favs: favIds(), bought: boughtIds() });
  function save(force) {
    const body = payload();
    if (!force && body === lastSent) return Promise.resolve(true);
    return fetch(endpoint + '/save?u=' + encodeURIComponent(U), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    }).then(r => { if (r.ok) { lastSent = body; return true; } return false; })
      .catch(() => false);
  }
  function scheduleSave() { clearTimeout(timer); timer = setTimeout(() => save(false), 1000); }
  window.MV.onChange(scheduleSave);

  const modal = document.getElementById('submodal');
  const linkInput = document.getElementById('sub-link');
  const copyBtn = document.getElementById('sub-copy');
  const openLink = document.getElementById('sub-open');
  const closeBtn = document.getElementById('sub-close');

  function open() {
    if (linkInput) linkInput.value = subUrl;
    if (openLink) openLink.href = webcal;
    const n = favIds().length;
    if (!n) {
      setStatus('Du har inga favoriter än – markera några med stjärnan först.', 'warn');
    } else {
      setStatus('Synkar ' + n + (n === 1 ? ' favorit…' : ' favoriter…'), '');
      save(true).then(ok => setStatus(
        ok ? '✓ ' + n + (n === 1 ? ' favorit synkad.' : ' favoriter synkade.')
           : 'Kunde inte nå servern. Kontrollera anslutningen och försök igen.',
        ok ? 'ok' : 'warn'));
    }
    if (modal) modal.hidden = false;
  }
  function close() { if (modal) modal.hidden = true; }

  if (btn) btn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (modal) modal.addEventListener('click', ev => { if (ev.target === modal) close(); });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && modal && !modal.hidden) close();
  });
  if (copyBtn) copyBtn.addEventListener('click', () => {
    const text = linkInput ? linkInput.value : subUrl;
    const done = () => { copyBtn.textContent = 'Kopierad!'; setTimeout(() => { copyBtn.textContent = 'Kopiera'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => { if (linkInput) linkInput.select(); });
    } else if (linkInput) { linkInput.select(); try { document.execCommand('copy'); done(); } catch (e) {} }
  });
})();
"""

STATE_JS = r"""
(function () {
  const FAV_KEY = 'mv_fav_v1';
  const BUY_KEY = 'mv_bought_v1';
  const HIDE_KEY = 'mv_hidden_v1';
  const HT_KEY = 'mv_hidetitles_v1';
  function load(k){ try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); }
    catch (e) { return new Set(); } }
  const favs = load(FAV_KEY);
  const bought = load(BUY_KEY);
  const hidden = load(HIDE_KEY);
  const HT = load(HT_KEY);   // titles hidden for ALL their occurrences
  function save(){ try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
    localStorage.setItem(BUY_KEY, JSON.stringify([...bought]));
    localStorage.setItem(HIDE_KEY, JSON.stringify([...hidden]));
    localStorage.setItem(HT_KEY, JSON.stringify([...HT]));
  } catch (e) {} }
  const listeners = [];
  function notify(){ listeners.forEach(fn => { try { fn(); } catch (e) {} }); }
  function find(id){ return document.querySelector('.event[data-id="' + id + '"]'); }
  function countTitle(t){ let n = 0;
    document.querySelectorAll('.event').forEach(e => { if (e.dataset.title === t) n++; });
    return n; }
  function elHidden(el){ return !!el && (hidden.has(el.dataset.id) || HT.has(el.dataset.title)); }

  function sync(el){
    if (!el) return;
    const id = el.dataset.id;
    const fav = favs.has(id);
    const buy = bought.has(id);
    const hid = elHidden(el);
    const ticketed = !!el.dataset.ticket;
    el.classList.toggle('is-fav', fav);
    el.classList.toggle('is-bought', buy);
    el.classList.toggle('is-hidden', hid);
    el.classList.toggle('needs-ticket', fav && ticketed && !buy);
    const favBtn = el.querySelector('.act.fav');
    if (favBtn){ favBtn.setAttribute('aria-pressed', fav ? 'true' : 'false');
      favBtn.title = fav ? 'Ta bort favorit' : 'Markera som favorit'; }
    const buyBtn = el.querySelector('.act.bought');
    if (buyBtn){ buyBtn.setAttribute('aria-pressed', buy ? 'true' : 'false');
      buyBtn.title = buy ? 'Biljett markerad som köpt' : 'Markera att du köpt biljett'; }
    const hideBtn = el.querySelector('.act.hide');
    if (hideBtn){ hideBtn.setAttribute('aria-pressed', hid ? 'true' : 'false');
      hideBtn.textContent = hid ? '\u21a9' : '\u2715';
      hideBtn.title = hid ? 'Visa det här eventet igen' : 'Dölj det här eventet'; }
  }
  function syncAll(){ document.querySelectorAll('.event').forEach(sync); }

  function toggleFav(id){
    if (favs.has(id)) favs.delete(id); else favs.add(id);
    save(); sync(find(id)); notify();
  }
  function toggleBought(id){
    if (bought.has(id)) { bought.delete(id); }
    else { bought.add(id); favs.add(id); }   // buying auto-marks as favourite
    save(); sync(find(id)); notify();
  }
  function hideOne(id){ hidden.add(id); save(); sync(find(id)); notify(); }
  function showOne(id){ hidden.delete(id); save(); sync(find(id)); notify(); }
  function hideTitle(title){
    HT.add(title);
    // Individual hides for the same title are now redundant.
    document.querySelectorAll('.event').forEach(e => {
      if (e.dataset.title === title) hidden.delete(e.dataset.id);
    });
    save(); syncAll(); notify();
  }
  function showTitle(title){
    HT.delete(title);
    document.querySelectorAll('.event').forEach(e => {
      if (e.dataset.title === title) hidden.delete(e.dataset.id);
    });
    save(); syncAll(); notify();
  }

  // Decide single vs. all-occurrences via the styled dialog (window.MVHIDE).
  function requestHide(id, opts){
    opts = opts || {};
    const el = find(id);
    const title = el ? el.dataset.title : '';
    const titleHidden = title && HT.has(title);

    if (titleHidden || hidden.has(id)) {           // currently hidden -> restore
      if (titleHidden) {
        const n = countTitle(title);
        if (window.MVHIDE && n > 1) {
          window.MVHIDE.open({ mode:'restore', title:title, count:n,
            onAll: () => { showTitle(title); if (opts.onChange) opts.onChange(); } });
          return;
        }
        showTitle(title);
      } else {
        showOne(id);
      }
      if (opts.onChange) opts.onChange();
      return;
    }

    const n = title ? countTitle(title) : 1;       // not hidden -> hide
    if (window.MVHIDE && n > 1) {
      window.MVHIDE.open({ mode:'hide', title:title, count:n,
        onAll: () => { hideTitle(title); if (opts.onHidden) opts.onHidden(); },
        onOne: () => { hideOne(id); if (opts.onHidden) opts.onHidden(); } });
      return;
    }
    hideOne(id);
    if (opts.onHidden) opts.onHidden();
  }

  function clearHidden(){
    if (!hidden.size && !HT.size) return;
    hidden.clear(); HT.clear(); save(); syncAll(); notify();
  }

  window.MV = {
    isFav: id => favs.has(id),
    isBought: id => bought.has(id),
    isHidden: id => elHidden(find(id)),
    isHiddenEl: elHidden,
    isTitleHidden: title => HT.has(title),
    toggleFav: toggleFav,
    toggleBought: toggleBought,
    requestHide: requestHide,
    clearHidden: clearHidden,
    sync: sync, syncAll: syncAll,
    onChange: fn => listeners.push(fn),
  };

  document.addEventListener('click', ev => {
    const btn = ev.target.closest('.event-actions .act');
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    const host = btn.closest('.event');
    if (!host) return;
    const id = host.dataset.id;
    if (btn.classList.contains('fav')) toggleFav(id);
    else if (btn.classList.contains('bought')) toggleBought(id);
    else if (btn.classList.contains('hide')) requestHide(id);
  });

  syncAll();
})();
"""


def _pos(minute_offset: int) -> float:
    return round(minute_offset * PX_PER_MIN, 1)


def _event_block_html(p: Placement, day: DayLayout, lane_count: int) -> str:
    e = p.event
    color = category_color(e.category)
    event_id = event_dom_id(e)
    top = _pos(e.start_min - day.day_start_min)
    height = _pos(e.end_min - e.start_min)
    left = p.lane / lane_count * 100
    width = p.span / lane_count * 100
    short_cls = " short" if height < 34 else ""
    time_txt = f"{e.start}\u2013{e.end}"

    pieces = [f"<span class='t'>{html.escape(time_txt)}</span>",
              f"<span class='ttl'>{html.escape(e.title)}</span>"]
    if e.organizer and e.organizer.strip().lower() != e.venue.strip().lower():
        pieces.append(f"<span class='org'>{html.escape(e.organizer)}</span>")
    meta = []
    if e.category:
        meta.append(f"<span class='badge'>{html.escape(e.category)}</span>")
    if e.status:
        if e.ticket_url:
            meta.append(
                f"<a class='badge ticket' href=\"{html.escape(e.ticket_url, quote=True)}\" "
                f"target='_blank' rel='noopener'>{html.escape(e.status)} \u2197</a>"
            )
        else:
            meta.append(f"<span class='badge'>{html.escape(e.status)}</span>")
    if meta:
        pieces.append("<div class='meta'>" + "".join(meta) + "</div>")
    # Quick actions (favourite / bought) + click-for-details hint, top-right corner.
    actions = ["<span class='warn' title='Favorit med biljett \u2013 inte markerad som k\u00f6pt'>!</span>"]
    if e.ticket_url:
        actions.append(
            "<button type='button' class='act bought' aria-pressed='false' "
            "title='Markera att du k\u00f6pt biljett'>" + TICKET_SVG + "</button>"
        )
    actions.append(
        "<button type='button' class='act fav' aria-pressed='false' "
        "title='Markera som favorit'>\u2605</button>"
    )
    actions.append(
        "<button type='button' class='act hide' aria-pressed='false' "
        "title='D\u00f6lj det h\u00e4r eventet'>\u2715</button>"
    )
    actions.append("<span class='info' aria-hidden='true'>i</span>")
    pieces.append("<div class='event-actions'>" + "".join(actions) + "</div>")

    # Hover tooltip: concise summary plus a short description snippet.
    tooltip = f"{time_txt} \u00b7 {e.title}"
    if e.organizer:
        tooltip += f" \u00b7 {e.organizer}"
    tooltip += f" \u00b7 {e.venue}"
    if e.description:
        snippet = " ".join(e.description.split())
        if len(snippet) > 220:
            snippet = snippet[:220].rstrip() + "\u2026"
        tooltip += f"\n\n{snippet}"
    tooltip += "\n\n(Klicka för detaljer)"

    search = " ".join([e.title, e.organizer, e.venue, e.category, e.status, e.description]).lower()
    cat_key = e.category if e.category else NO_CATEGORY
    style = (f"top:{top}px;height:{height}px;left:{left:.4f}%;"
             f"width:calc({width:.4f}% - 3px);background:#{color};")
    attrs = [
        f"data-id=\"{event_id}\"",
        f"data-s=\"{e.start_min}\" data-e=\"{e.end_min}\"",
        f"data-venue=\"{html.escape(e.venue, quote=True)}\"",
        f"data-cat=\"{html.escape(cat_key, quote=True)}\"",
        f"data-title=\"{html.escape(e.title, quote=True)}\"",
        f"data-time=\"{html.escape(time_txt, quote=True)}\"",
        f"data-color=\"{color}\"",
        f"data-search=\"{html.escape(search, quote=True)}\"",
    ]
    if e.organizer:
        attrs.append(f"data-org=\"{html.escape(e.organizer, quote=True)}\"")
    if e.status:
        attrs.append(f"data-status=\"{html.escape(e.status, quote=True)}\"")
    if e.ticket_url:
        attrs.append(f"data-ticket=\"{html.escape(e.ticket_url, quote=True)}\"")
    if e.description:
        attrs.append(f"data-desc=\"{html.escape(e.description, quote=True)}\"")
    return (
        f"<div class='event{short_cls}' style='{style}' title='{html.escape(tooltip)}' "
        + " ".join(attrs) + ">"
        + "".join(pieces) + "</div>"
    )


def _day_board_html(day: DayLayout) -> str:
    track_h = _pos(day.day_end_min - day.day_start_min)
    slot_px = round(day.slot_minutes * PX_PER_MIN, 1)
    out: list[str] = [
        f"<div class='board-scroll'><div class='board' style='--slot-px:{slot_px}px' "
        f"data-day-start='{day.day_start_min}' data-day-end='{day.day_end_min}' "
        f"data-slot='{day.slot_minutes}' data-px='{PX_PER_MIN}'>"
    ]

    # Left time axis (sticky).
    out.append("<div class='axis-col'><div class='axis-head'>Tid</div>")
    out.append(f"<div class='axis-body' style='height:calc(var(--vis,{track_h}px) + 2 * var(--board-pad))'>")
    out.append(f"<div class='axis-inner' style='height:{track_h}px'>")
    minute = day.day_start_min
    while minute <= day.day_end_min:
        top = _pos(minute - day.day_start_min)
        hour_cls = " hour" if minute % 60 == 0 else ""
        out.append(f"<div class='tick{hour_cls}' style='top:{top}px'>{minutes_to_hhmm(minute)}</div>")
        minute += day.slot_minutes
    out.append("</div></div></div>")

    # One flex column per venue; events absolutely positioned by time + lane.
    for v in day.venues:
        min_w = max(150, v.lane_count * 132)
        out.append(
            f"<div class='venue-col' data-venue=\"{html.escape(v.venue, quote=True)}\" "
            f"style='min-width:{min_w}px'>"
            f"<div class='venue-head' title=\"{html.escape(v.venue, quote=True)}\">"
            f"{html.escape(v.venue)}</div>"
            f"<div class='track'><div class='track-inner' style='height:{track_h}px'>"
        )
        for p in v.placements:
            out.append(_event_block_html(p, day, v.lane_count))
        out.append("</div></div></div>")

    out.append("</div></div>")
    return "".join(out)


def _toolbar_html(events: list[Event], ics_endpoint: str = "") -> str:
    cats = sorted({e.category for e in events if e.category})
    cat_items = [(c, c, category_color(c)) for c in cats]
    if any(not e.category for e in events):
        cat_items.append((NO_CATEGORY, "Utan kategori", DEFAULT_CATEGORY_COLOR))
    cat_boxes = "".join(
        f"<label><input type='checkbox' class='catbox' value=\"{html.escape(val, quote=True)}\" checked> "
        f"<i style='background:#{color}'></i>{html.escape(label)}</label>"
        for val, label, color in cat_items
    )
    venues = sorted({e.venue for e in events}, key=lambda s: (s == "Okänd plats", s.lower()))
    boxes = "".join(
        f"<label><input type='checkbox' class='venuebox' value=\"{html.escape(v, quote=True)}\" checked> "
        f"{html.escape(v)}</label>"
        for v in venues
    )
    sub_btn = (
        "<button class='reset' id='subFav' "
        "title='Prenumerera p\u00e5 dina favoriter i din kalenderapp'>\U0001f517 Prenumerera</button>"
        if ics_endpoint else ""
    )
    return (
        "<div class='toolbar'>"
        "<input id='q' type='search' placeholder='Sök titel, arrangör eller plats…' "
        "aria-label='Sök'>"
        "<details class='filtermenu'><summary>Kategorier ▾</summary>"
        "<div class='filterpanel'>"
        "<div class='filtertools'>"
        "<button id='catAll'>Alla</button><button id='catNone'>Inga</button>"
        "<input id='catFilter' class='vfilter' placeholder='filtrera kategorier'>"
        "</div>"
        f"<div class='filterlist'>{cat_boxes}</div>"
        "</div></details>"
        "<details class='filtermenu'><summary>Platser ▾</summary>"
        "<div class='filterpanel'>"
        "<div class='filtertools'>"
        "<button id='venueAll'>Alla</button><button id='venueNone'>Inga</button>"
        "<input id='venueFilter' class='vfilter' placeholder='filtrera platser'>"
        "</div>"
        f"<div class='filterlist'>{boxes}</div>"
        "</div></details>"
        "<label class='favtoggle'><input type='checkbox' id='favOnly'> \u2605 Bara favoriter</label>"
        "<label class='favtoggle'><input type='checkbox' id='showHidden'> \U0001f441 Visa dolda (<span id='hiddenCount'>0</span>)</label>"
        "<button class='reset' id='unhideAll' title='Visa alla dolda event igen' style='display:none'>\u21a9 Visa alla dolda</button>"
        "<button class='reset' id='printFav' title='\u00d6ppna en utskriftsv\u00e4nlig lista \u00f6ver dina favoriter'>\u2605 Skriv ut favoriter</button>"
        "<button class='reset' id='icsFav' title='Ladda ner dina favoriter som en kalenderfil (.ics)'>\U0001f4c5 Lägg till i kalender</button>"
        f"{sub_btn}"
        "<button class='reset' id='reset'>Återställ</button>"
        "<span class='count' id='count'></span>"
        "</div>"
    )


def write_html(events: list[Event], path: Path, slot_minutes: int, ics_endpoint: str = "") -> None:
    by_day: dict[str, list[Event]] = defaultdict(list)
    for e in events:
        by_day[e.date].append(e)
    days = sorted(by_day)
    layouts = [build_day_layout(d, by_day[d], slot_minutes) for d in days]

    nav = "".join(
        f"<a href='#day-{l.date}'>{html.escape((l.weekday[:3] or l.date))} {l.date[5:]}</a>"
        for l in layouts
    )

    parts = [
        "<!doctype html><html lang='sv'><head><meta charset='utf-8'>",
        "<meta name='viewport' content='width=device-width, initial-scale=1'>",
        "<title>Medeltidsveckan – schema</title>",
        f"<style>{PAGE_CSS}</style></head><body>",
        "<header class='top'><h1>Medeltidsveckan – schema</h1>",
        "<p>Tidslinje per dag. Krockande programpunkter på samma plats visas bredvid "
        "varandra; längre punkter visas som sammanhängande block. Sök och filtrera nedan. "
        "Kontrollera biljettkrävande punkter mot originalprogrammet före bokning.</p></header>",
        f"<nav class='days'>{nav}</nav>",
        _toolbar_html(events, ics_endpoint),
    ]
    for layout in layouts:
        title = f"{layout.weekday} {layout.date}".strip()
        parts.append(f"<section class='day' id='day-{layout.date}'><h2>{html.escape(title)}</h2>")
        parts.append(_day_board_html(layout))
        parts.append("</section>")
    parts.append(MODAL_HTML)
    parts.append(PRINTVIEW_HTML)
    parts.append(SUBSCRIBE_HTML)
    parts.append(HIDE_DIALOG_HTML)
    cfg_json = json.dumps({"icsEndpoint": ics_endpoint or ""}, ensure_ascii=False)
    parts.append(f"<script>window.MV_CFG = {cfg_json};</script>")
    parts.append(f"<script>{STATE_JS}</script>")
    parts.append(f"<script>{HIDE_JS}</script>")
    parts.append(f"<script>{SCRIPT_JS}</script>")
    parts.append(f"<script>{MODAL_JS}</script>")
    parts.append(f"<script>{PRINT_JS}</script>")
    parts.append(f"<script>{CALENDAR_JS}</script>")
    parts.append(f"<script>{SYNC_JS}</script>")
    parts.append("</body></html>")
    path.write_text("".join(parts), encoding="utf-8")


def write_worker_data(events: list[Event], path: Path) -> int:
    """Dump the programme as a JS module the subscription Worker can import.

    The Worker only stores each user's *favourite ids*; the event details live
    here, keyed by the same id as the HTML's ``data-id``. Keys are short to keep
    the bundle small: d(ate) s(tart_min) e(nd_min) t(itle) v(enue) o(rganizer)
    c(ategory) desc tk(ticket url).
    """
    programme: dict[str, dict] = {}
    for e in events:
        rec: dict[str, object] = {
            "d": e.date, "s": e.start_min, "e": e.end_min, "t": e.title, "v": e.venue,
        }
        if e.organizer:
            rec["o"] = e.organizer
        if e.category:
            rec["c"] = e.category
        if e.description:
            rec["desc"] = e.description
        if e.ticket_url:
            rec["tk"] = e.ticket_url
        programme[event_dom_id(e)] = rec
    payload = json.dumps(programme, ensure_ascii=False, separators=(",", ":"))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "// Auto-generated by build_schedule.py \u2013 do not edit by hand.\n"
        "// Maps event id (same as the schema's data-id) to event details.\n"
        f"export const PROGRAMME = {payload};\n",
        encoding="utf-8",
    )
    return len(programme)


# --------------------------------------------------------------------------- #
# Excel (mirrors the lane layout with merged cells)
# --------------------------------------------------------------------------- #
def _style_excel_event(cell, color: str) -> None:
    cell.fill = PatternFill("solid", fgColor=color)
    cell.font = Font(color="FFFFFF", bold=False, size=9)
    cell.alignment = Alignment(vertical="top", wrap_text=True)


def write_excel(events: list[Event], path: Path, slot_minutes: int) -> None:
    if openpyxl is None:
        raise RuntimeError("Installera openpyxl: pip install openpyxl")

    by_day: dict[str, list[Event]] = defaultdict(list)
    for e in events:
        by_day[e.date].append(e)

    wb = openpyxl.Workbook()
    raw = wb.active
    raw.title = "Alla event"
    headers = ["date", "weekday", "start", "end", "venue", "title", "organizer",
               "category", "status", "ticket_url", "duration_source"]
    raw.append(headers)
    for e in sorted(events, key=lambda x: (x.date, x.start, x.venue, x.title)):
        raw.append([e.date, e.weekday, e.start, e.end, e.venue, e.title,
                    e.organizer, e.category, e.status, e.ticket_url, e.duration_source])
    _style_raw_sheet(raw)

    thin = Side(style="thin", color="DDDDDD")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    header_fill = PatternFill("solid", fgColor="5C2C14")
    header_font = Font(color="FFFFFF", bold=True)

    for date_s in sorted(by_day):
        layout = build_day_layout(date_s, by_day[date_s], slot_minutes)
        sheet_title = f"{(layout.weekday[:3] or '')} {date_s[5:]}".strip()
        ws = wb.create_sheet(sheet_title[:31])

        venue_base: dict[str, int] = {}
        col = 2
        ws.cell(1, 1, "Tid").fill = header_fill
        ws.cell(1, 1).font = header_font
        ws.cell(1, 1).alignment = Alignment(horizontal="center", vertical="center")
        for v in layout.venues:
            venue_base[v.venue] = col
            c1, c2 = col, col + v.lane_count - 1
            if c2 > c1:
                ws.merge_cells(start_row=1, start_column=c1, end_row=1, end_column=c2)
            cell = ws.cell(1, c1, v.venue)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
            col += v.lane_count
        total_cols = col - 1

        # Time labels every slot; one spreadsheet row per base unit.
        rows_per_slot = layout.rows_per_slot
        for row_idx, minute in layout.slot_ticks():
            r = row_idx + 2
            tcell = ws.cell(r, 1, minutes_to_hhmm(minute))
            tcell.font = Font(bold=True, size=9, color="6B5D4F")
            tcell.alignment = Alignment(horizontal="right", vertical="top")

        # Event blocks: vertical merge for duration, horizontal merge for lane span.
        for v in layout.venues:
            for p in v.placements:
                r1 = p.row_start + 2
                r2 = p.row_end + 2 - 1
                c1 = venue_base[v.venue] + p.lane
                c2 = c1 + p.span - 1
                if r2 > r1 or c2 > c1:
                    ws.merge_cells(start_row=r1, start_column=c1, end_row=r2, end_column=c2)
                text = f"{p.event.start}\u2013{p.event.end}\n{p.event.title}"
                if p.event.organizer and p.event.organizer.lower() != p.event.venue.lower():
                    text += f"\n{p.event.organizer}"
                if p.event.status:
                    text += f"\n[{p.event.status}]"
                cell = ws.cell(r1, c1, text)
                _style_excel_event(cell, category_color(p.event.category))

        # Column widths + row heights + borders on the time column.
        ws.column_dimensions[get_column_letter(1)].width = 7
        for c in range(2, total_cols + 1):
            ws.column_dimensions[get_column_letter(c)].width = 22
        per_base_height = max(8.0, layout.base_minutes * 0.9)
        for r in range(2, layout.rows + 2):
            ws.row_dimensions[r].height = per_base_height
        ws.freeze_panes = "B2"
        for r in range(1, layout.rows + 2):
            ws.cell(r, 1).border = border

    wb.save(path)


def _style_raw_sheet(ws) -> None:
    ws.freeze_panes = "A2"
    header_fill = PatternFill("solid", fgColor="5C2C14")
    header_font = Font(color="FFFFFF", bold=True)
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    widths = {"date": 12, "weekday": 10, "start": 7, "end": 7, "venue": 30,
              "title": 42, "organizer": 26, "category": 16, "status": 14,
              "ticket_url": 40, "duration_source": 16}
    for idx, name in enumerate([c.value for c in ws[1]], start=1):
        ws.column_dimensions[get_column_letter(idx)].width = widths.get(name, 14)
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.alignment = Alignment(vertical="top", wrap_text=True)


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def _load_config(outdir: Path) -> dict:
    """Load the small persisted config (e.g. the subscription endpoint)."""
    path = outdir / CONFIG_FILENAME
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
        except (ValueError, OSError):
            pass
    return {}


def _save_config(outdir: Path, cfg: dict) -> None:
    path = outdir / CONFIG_FILENAME
    path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _resolve_inputs(outdir: Path, explicit: list[str] | None,
                    include_inofficial: bool = True) -> list[Path]:
    """Pick the data file(s) to render.

    With ``--input`` the given files are used as-is. Otherwise the official
    programme file is auto-discovered in ``outdir`` and, unless disabled, the
    unofficial programme file (``medeltidsveckan_inofficial.*``) is merged in too.
    """
    if explicit:
        return [Path(x) for x in explicit]

    def first_existing(*names: str) -> Path | None:
        for name in names:
            candidate = outdir / name
            if candidate.exists():
                return candidate
        return None

    paths: list[Path] = []
    main = first_existing("medeltidsveckan_events.json", "medeltidsveckan_events.csv")
    if main:
        paths.append(main)
    if include_inofficial:
        inof = first_existing("medeltidsveckan_inofficial.json", "medeltidsveckan_inofficial.csv")
        if inof:
            paths.append(inof)
    if not paths:
        raise SystemExit(
            f"Hittade ingen datafil i {outdir}. Kör först: python fetch_programme.py"
        )
    return paths


def _collect_exclude_patterns(args, outdir: Path) -> list[str]:
    """Gather exclusion patterns from the exclude file (if any) and --exclude."""
    patterns: list[str] = []
    if not args.no_exclude_file:
        if args.exclude_file:
            exclude_path = Path(args.exclude_file)
        else:
            # Default: next to the scripts, then fall back to the output dir.
            here = Path(__file__).resolve().parent / DEFAULT_EXCLUDE_FILENAME
            exclude_path = here if here.exists() else outdir / DEFAULT_EXCLUDE_FILENAME
        file_patterns = load_exclude_patterns(exclude_path)
        if file_patterns:
            print(f"Läste {len(file_patterns)} exkluderingsmönster från {exclude_path}.")
        patterns.extend(file_patterns)
    patterns.extend(args.exclude or [])
    return patterns


def main() -> None:
    p = argparse.ArgumentParser(description="Bygger schemagränssnittet från datafilen.")
    p.add_argument("--input", action="append", default=None, metavar="FIL",
                   help="Datafil (.json/.csv). Kan upprepas. Standard: leta i --outdir.")
    p.add_argument("--outdir", default="medeltidsveckan_output")
    p.add_argument("--slot-minutes", type=int, default=30,
                   help="Tidsupplösning för rutnätets etiketter.")
    p.add_argument("--no-inofficial", action="store_true",
                   help="Ta inte med det inofficiella programmet (imtv.se) även om datafilen finns.")
    p.add_argument("--exclude", action="append", default=[], metavar="TITEL",
                   help="Titel att filtrera bort (kan upprepas). Stöder * och ? som jokertecken.")
    p.add_argument("--exclude-file", default=None,
                   help=f"Fil med titlar att filtrera bort (en per rad). Standard: {DEFAULT_EXCLUDE_FILENAME} bredvid skripten.")
    p.add_argument("--no-exclude-file", action="store_true",
                   help="Ignorera exclude-filen även om den finns.")
    p.add_argument("--no-excel", action="store_true", help="Hoppa över Excel-utdata.")
    p.add_argument("--ics-endpoint", default=None, metavar="URL",
                   help="Bas-URL till prenumerations-Workern, t.ex. "
                        "https://mv.<konto>.workers.dev. Sparas i "
                        f"{CONFIG_FILENAME} och aktiverar Prenumerera-knappen.")
    p.add_argument("--no-ics-endpoint", action="store_true",
                   help="Dölj Prenumerera-knappen även om en endpoint är sparad.")
    p.add_argument("--worker-data", default=None, metavar="FIL",
                   help="Var programdatan för Workern skrivs "
                        "(standard: worker/src/programme.js bredvid skripten).")
    args = p.parse_args()

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    input_paths = _resolve_inputs(outdir, args.input, include_inofficial=not args.no_inofficial)

    events: list[Event] = []
    per_file: list[tuple[Path, int]] = []
    for ip in input_paths:
        loaded = load_events(ip)
        per_file.append((ip, len(loaded)))
        events.extend(loaded)
    events = dedupe(events)
    if not events:
        raise SystemExit(f"Datafilerna innehåller inga event: {', '.join(str(p) for p in input_paths)}")

    patterns = _collect_exclude_patterns(args, outdir)
    if patterns:
        events, removed = filter_events(events, patterns)
        total_removed = sum(removed.values())
        if total_removed:
            print(f"Filtrerade bort {total_removed} event via {len(removed)} titelmönster:")
            for pat, n in removed.most_common():
                print(f"  − {n:3} × {pat}")
        else:
            print("Inga event matchade exkluderingsmönstren.")
        if not events:
            raise SystemExit("Alla event filtrerades bort – kontrollera dina exclude-mönster.")

    config = _load_config(outdir)
    if args.no_ics_endpoint:
        ics_endpoint = ""
    elif args.ics_endpoint is not None:
        ics_endpoint = args.ics_endpoint.rstrip("/")
        config["ics_endpoint"] = ics_endpoint
        _save_config(outdir, config)
        print(f"Sparade prenumerations-endpoint i {outdir / CONFIG_FILENAME}")
    else:
        ics_endpoint = config.get("ics_endpoint", "")

    html_path = outdir / "medeltidsveckan_schema.html"
    write_html(events, html_path, args.slot_minutes, ics_endpoint)
    if len(per_file) == 1:
        print(f"Läste {per_file[0][1]} event från {per_file[0][0]}.")
    else:
        print(f"Läste {len(events)} event (efter sammanslagning) från {len(per_file)} filer:")
        for path, n in per_file:
            print(f"  • {n:4} × {path.name}")
    print(f"Skapade: {html_path}")

    worker_data_path = (
        Path(args.worker_data) if args.worker_data
        else Path(__file__).resolve().parent / "worker" / "src" / "programme.js"
    )
    n_prog = write_worker_data(events, worker_data_path)
    print(f"Skapade: {worker_data_path} ({n_prog} event för prenumeration)")
    if ics_endpoint:
        print(f"Prenumerations-endpoint: {ics_endpoint}")

    if not args.no_excel:
        xlsx_path = outdir / "medeltidsveckan_schema.xlsx"
        write_excel(events, xlsx_path, args.slot_minutes)
        print(f"Skapade: {xlsx_path}")


if __name__ == "__main__":
    main()
