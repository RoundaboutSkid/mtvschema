/* Medeltidsveckan – schema (klient-app)
 *
 * Renderar hela schemat i webbläsaren från window.MV_DATA (genererad av
 * build_schedule.py). DOM:en som byggs här är identisk med den Python tidigare
 * genererade, så all interaktionslogik nedan (favoriter, dölj, modal, utskrift,
 * .ics, prenumeration) fungerar oförändrat.
 *
 * Ordning: RENDER bygger nav/verktygsrad/dagar FÖRST. Därefter kör de moduler
 * som tidigare låg i varsin <script>-tagg (STATE, HIDE, SCRIPT, MODAL, PRINT,
 * CALENDAR, SYNC) precis som förr.
 */

/* --------------------------------------------------------------------------
 * RENDER – bygg DOM från MV_DATA
 * ------------------------------------------------------------------------ */
function mvTicketIcon(cls) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('ticket-icon');
  if (cls) svg.classList.add(cls);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const outline = document.createElementNS(ns, 'path');
  outline.setAttribute('d',
    'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z');
  const cuts = document.createElementNS(ns, 'path');
  cuts.setAttribute('d', 'M13 5v2M13 17v2M13 11v2');
  svg.appendChild(outline);
  svg.appendChild(cuts);
  return svg;
}

(function () {
  const DATA = (typeof window !== 'undefined' && window.MV_DATA) || {};
  window.MV_CFG = { icsEndpoint: DATA.icsEndpoint || '' };

  // Fast bredd per guide-lane -> korten får konstant bredd även när många
  // programpunkter pågår samtidigt.
  const LANE_W = 150;

  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  function wireDayLink(a, d) {
    a.classList.add('daylink');
    a.addEventListener('click', e => {
      if (document.body.dataset.view === 'flow') return;
      if (document.body.dataset.view === 'map') {
        if (window.MVMAP && window.MVMAP.selectDate(d.date)) e.preventDefault();
        return;
      }
      if (document.body.dataset.view === 'guide') {
        const sc = document.querySelector('.guide-scroll.merged-guide');
        const day = document.querySelector('.guide-day[data-date="' + d.date + '"]');
        if (sc && day) {
          e.preventDefault();
          sc.scrollTop = Math.max(0, day.offsetTop - 34);
        }
      }
    });
  }

  // ---- Dag-navigering -----------------------------------------------------
  function renderNav() {
    const nav = document.getElementById('mv-nav');
    if (!nav) return;
    nav.textContent = '';
    (DATA.days || []).forEach(d => {
      const a = document.createElement('a');
      a.href = '#day-' + d.date;
      a.textContent = d.label;
      // I programguiden ligger dagarna i den sammanslagna guideytan, så hoppa
      // genom att skrolla den. I kartvyn väljer dagknapparna första synliga
      // platsen för dagen.
      wireDayLink(a, d);
      nav.appendChild(a);
    });
  }

  // ---- Verktygsrad --------------------------------------------------------
  function renderToolbar() {
    const tb = document.getElementById('mv-toolbar');
    if (!tb) return;
    tb.className = 'toolbar';
    const subBtn = DATA.icsEndpoint
      ? "<button class='reset' id='subFav' title='Prenumerera på dina favoriter i din kalenderapp'>🔗 Prenumerera</button>"
      : "";
    tb.innerHTML =
      "<input id='q' type='search' placeholder='Sök titel, arrangör eller plats…' aria-label='Sök'>" +
      "<div class='compact-pop day-pop'>" +
      "<button type='button' class='compact-toggle' aria-expanded='false'>Gå till dag</button>" +
      "<div class='compact-panel compact-day-panel' id='compactDayPanel'></div>" +
      "</div>" +
      "<div class='compact-pop filter-pop'>" +
      "<button type='button' class='compact-toggle' aria-expanded='false'>Filter</button>" +
      "<div class='compact-panel compact-filter-panel'>" +
      "<details class='filtermenu'><summary>Kategorier ▾</summary>" +
      "<div class='filterpanel'>" +
      "<div class='filtertools'>" +
      "<button id='catAll'>Alla</button><button id='catNone'>Inga</button>" +
      "<input id='catFilter' class='vfilter' placeholder='filtrera kategorier'>" +
      "</div>" +
      "<div class='filterlist' id='catList'></div>" +
      "</div></details>" +
      "<details class='filtermenu'><summary>Platser ▾</summary>" +
      "<div class='filterpanel'>" +
      "<div class='filtertools'>" +
      "<button id='venueAll'>Alla</button><button id='venueNone'>Inga</button>" +
      "<input id='venueFilter' class='vfilter' placeholder='filtrera platser'>" +
      "</div>" +
      "<div class='filterlist' id='venueList'></div>" +
      "</div></details>" +
      "<label class='favtoggle'><input type='checkbox' id='favOnly'> ★ Bara favoriter</label>" +
      "<label class='favtoggle'><input type='checkbox' id='showHidden'> 👁 Visa dolda (<span id='hiddenCount'>0</span>)</label>" +
      "<button class='reset' id='reset'>Återställ</button>" +
      "</div>" +
      "</div>" +
      "<div class='compact-pop more-pop'>" +
      "<button type='button' class='compact-toggle' aria-expanded='false'>Mer</button>" +
      "<div class='compact-panel compact-more-panel'>" +
      "<button class='reset' id='unhideAll' title='Visa alla dolda event igen' style='display:none'>↩ Visa alla dolda</button>" +
      "<button class='reset' id='printFav' title='Öppna en utskriftsvänlig lista över dina favoriter'>★ Skriv ut favoriter</button>" +
      "<button class='reset' id='icsFav' title='Ladda ner dina favoriter som en kalenderfil (.ics)'>📅 Lägg till i kalender</button>" +
      subBtn +
      "</div>" +
      "</div>" +
      "<button type='button' class='compact-toggle help-btn' id='helpBtn' title='Kom igång – så använder du schemat' aria-label='Hjälp'>❓</button>" +
      "<span class='count' id='count'></span>";

    const dayPanel = tb.querySelector('#compactDayPanel');
    (DATA.days || []).forEach(d => {
      const a = document.createElement('a');
      a.href = '#day-' + d.date;
      a.textContent = d.label;
      wireDayLink(a, d);
      dayPanel.appendChild(a);
    });

    const cl = tb.querySelector('#catList');
    (DATA.cats || []).forEach(c => {
      const lab = document.createElement('label');
      const inp = document.createElement('input');
      inp.type = 'checkbox'; inp.className = 'catbox'; inp.value = c.val; inp.checked = true;
      const i = document.createElement('i'); i.style.background = '#' + c.color;
      lab.appendChild(inp);
      lab.appendChild(document.createTextNode(' '));
      lab.appendChild(i);
      lab.appendChild(document.createTextNode(c.label));
      cl.appendChild(lab);
    });

    const vl = tb.querySelector('#venueList');
    (DATA.venues || []).forEach(v => {
      const lab = document.createElement('label');
      const inp = document.createElement('input');
      inp.type = 'checkbox'; inp.className = 'venuebox'; inp.value = v; inp.checked = true;
      lab.appendChild(inp);
      lab.appendChild(document.createTextNode(' ' + v));
      vl.appendChild(lab);
    });

    const closePops = () => tb.querySelectorAll('.compact-pop.open').forEach(pop => {
      pop.classList.remove('open');
      const btn = pop.querySelector('.compact-toggle');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
    tb.querySelectorAll('.compact-pop').forEach(pop => {
      const btn = pop.querySelector('.compact-toggle');
      if (!btn) return;
      btn.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const open = pop.classList.contains('open');
        closePops();
        pop.classList.toggle('open', !open);
        btn.setAttribute('aria-expanded', !open ? 'true' : 'false');
      });
    });
    tb.querySelectorAll('.compact-day-panel a').forEach(a => a.addEventListener('click', closePops));
    document.addEventListener('click', ev => {
      if (!tb.contains(ev.target)) closePops();
    });
    document.addEventListener('keydown', ev => {
      if (ev.key === 'Escape') closePops();
    });
  }

  // ---- Ett event-block ----------------------------------------------------
  function buildEvent(ev) {
    const n = el('div', 'event' + (ev.short ? ' short' : ''));
    // Höjd = varaktighet. Programguiden använder egen horisontell placering,
    // medan flödet och kartan läser samma eventdata utan tidslinjeposition.
    n.style.height = ev.height + 'px';
    n.dataset.ptop = ev.top;
    n.style.setProperty('--cat', '#' + ev.color);
    n.setAttribute('data-id', ev.id);
    n.setAttribute('data-s', ev.s);
    n.setAttribute('data-e', ev.e);
    n.setAttribute('data-venue', ev.venue);
    n.setAttribute('data-cat', ev.catKey);
    n.setAttribute('data-title', ev.title);
    n.setAttribute('data-time', ev.time);
    n.setAttribute('data-color', ev.color);
    n.setAttribute('data-search', ev.search);
    if (ev.org) n.setAttribute('data-org', ev.org);
    if (ev.status) n.setAttribute('data-status', ev.status);
    if (ev.ticket) n.setAttribute('data-ticket', ev.ticket);
    if (ev.desc) n.setAttribute('data-desc', ev.desc);
    if (ev.lat != null && ev.lng != null) {
      n.setAttribute('data-lat', ev.lat);
      n.setAttribute('data-lng', ev.lng);
    }
    n.setAttribute('data-zone', ev.zone || 'Z?');
    n.style.setProperty('--zone', '#' + (ev.zColor || '6B7280'));

    const t = el('span', 't'); t.textContent = ev.time; n.appendChild(t);
    const ttl = el('span', 'ttl'); ttl.textContent = ev.title; n.appendChild(ttl);
    if (ev.orgShow && ev.org) {
      const o = el('span', 'org'); o.textContent = ev.org; n.appendChild(o);
    }
    // Plats-etikett (ikon + plats). Visas i flödet (färgad zon-pill) och i zon-vyn.
    const place = el('span', 'ev-place');
    if (ev.icon) {
      const pic = el('span', 'picon'); pic.textContent = ev.icon; place.appendChild(pic);
      place.appendChild(document.createTextNode(' '));
    }
    const pnm = el('span', 'pname'); pnm.textContent = ev.venue || ''; place.appendChild(pnm);
    n.appendChild(place);

    if (ev.cat || (ev.status && !ev.ticket)) {
      const meta = el('div', 'meta');
      if (ev.cat) {
        // Fylld kategorifärg som i detaljvyns badge (samma färgsättning).
        const b = el('span', 'tag cat'); b.textContent = ev.cat;
        meta.appendChild(b);
      }
      if (ev.status && !ev.ticket) {
        const s = el('span', 'tag status'); s.textContent = ev.status; meta.appendChild(s);
      }
      n.appendChild(meta);
    }

    const acts = el('div', 'event-actions');
    if (ev.ticket) {
      // Egen SVG istället för emoji, så ikonen renderas stabilt även på Windows.
      const tk = el('span', 'tixmark');
      tk.setAttribute('aria-hidden', 'true');
      tk.title = 'Det här eventet kräver biljett';
      tk.appendChild(mvTicketIcon());
      acts.appendChild(tk);
    }
    const fav = el('button', 'act fav');
    fav.type = 'button'; fav.setAttribute('aria-pressed', 'false');
    fav.title = 'Markera som favorit'; fav.textContent = '★'; acts.appendChild(fav);
    n.appendChild(acts);
    const hide = el('button', 'event-hide');
    hide.type = 'button';
    hide.title = 'Dölj event';
    hide.setAttribute('aria-label', 'Dölj event');
    hide.textContent = '\u00d7';
    n.appendChild(hide);
    return n;
  }

  // ---- En dags flödeslista (kronologisk, mkal-stil) -----------------------
  // Alla dagens event i en platt, tidssorterad lista. Samma event-noder flyttas
  // till programguiden vid behov, så all wiring följer med.
  function buildFlowList(d) {
    const list = el('div', 'flow-list');
    const items = [];
    (d.venues || []).forEach(v => (v.events || []).forEach(ev => items.push(ev)));
    items.sort((a, b) => (a.s - b.s) || (a.e - b.e) || (a.title < b.title ? -1 : 1));
    items.forEach(ev => { const node = buildEvent(ev); node.dataset.date = d.date; list.appendChild(node); });
    return list;
  }

  // ---- Programguide (TV-guide-metafor): tid åt sidan, samtidiga val i rader --
  // Själva radpackningen görs i VIEW när eventnoderna flyttas hit, så samma
  // DOM-noder fortsätter bära favorit-, biljett-, modal- och filterlogik.
  const GUIDE_PX = 2.6;       // horisontell skala: 1 minut -> px

  function guideTimeLabel(minutes) {
    minutes %= 24 * 60;
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' +
      String(minutes % 60).padStart(2, '0');
  }

  function buildMergedGuideBoard() {
    const days = DATA.days || [];
    if (!days.length) return el('div', 'guide-scroll merged-guide');
    const dayStart = Math.min.apply(null, days.map(d => d.dayStart));
    const dayEnd = Math.max.apply(null, days.map(d => d.dayEnd));
    const trackW = Math.max(960, Math.round((dayEnd - dayStart) * GUIDE_PX));
    const scroll = el('div', 'guide-scroll merged-guide');
    const board = el('div', 'guide-board guide-merged-board');
    board.style.width = trackW + 'px';
    board.style.setProperty('--guide-half-hour', (30 * GUIDE_PX) + 'px');

    const ruler = el('div', 'guide-ruler');
    ruler.style.width = trackW + 'px';
    for (let minute = dayStart; minute <= dayEnd; minute += 30) {
      const x = Math.round((minute - dayStart) * GUIDE_PX);
      const mark = el('div', 'guide-tick' + (minute % 60 === 0 ? ' hour' : ''));
      mark.style.left = x + 'px';
      if (minute % 60 === 0) {
        mark.textContent = guideTimeLabel(minute);
      }
      ruler.appendChild(mark);
    }
    board.appendChild(ruler);

    const body = el('div', 'guide-days');
    days.forEach(d => {
      const day = el('div', 'guide-day');
      day.dataset.date = d.date;
      const head = el('div', 'guide-day-head');
      const title = el('span', 'guide-day-title');
      title.textContent = d.title;
      head.appendChild(title);
      day.appendChild(head);

      const track = el('div', 'guide-track');
      track.style.width = trackW + 'px';
      const inner = el('div', 'guide-track-inner');
      inner.dataset.date = d.date;
      inner.dataset.dayStart = dayStart;
      inner.dataset.dayEnd = dayEnd;
      inner.dataset.px = GUIDE_PX;
      inner.style.width = trackW + 'px';
      track.appendChild(inner);
      day.appendChild(track);
      body.appendChild(day);
    });
    board.appendChild(body);
    scroll.appendChild(board);
    return scroll;
  }

  // ---- En sammanslagen tavla för hela veckan ------------------------------
  // Alla dagar staplas vertikalt i EN skrollbar tavla med gemensamma (globala)
  function buildMapView() {
    const shell = el('section', 'map-view');
    shell.id = 'mv-map-view';

    const layout = el('div', 'map-layout');
    const canvas = el('div', 'map-canvas');
    canvas.id = 'mv-map';
    canvas.setAttribute('aria-label', 'Karta');

    const panel = el('aside', 'map-panel');
    const head = el('div', 'map-panel-head');
    const h2 = document.createElement('h2');
    h2.id = 'map-title';
    h2.textContent = 'Karta';
    const count = el('div', 'map-count');
    count.id = 'map-count';
    head.appendChild(h2);
    head.appendChild(count);

    const chooser = el('div', 'map-place-chooser');
    const placeToggle = document.createElement('button');
    placeToggle.type = 'button';
    placeToggle.className = 'map-place-toggle';
    placeToggle.id = 'map-place-toggle';
    placeToggle.setAttribute('aria-controls', 'map-places');
    placeToggle.setAttribute('aria-expanded', 'false');
    placeToggle.textContent = 'Byt plats';
    const places = el('div', 'map-places');
    places.id = 'map-places';
    places.hidden = true;
    chooser.appendChild(placeToggle);
    chooser.appendChild(places);
    head.appendChild(chooser);

    const list = el('div', 'map-list');
    list.id = 'map-list';
    const missing = el('div', 'map-missing');
    missing.id = 'map-missing';

    panel.appendChild(head);
    panel.appendChild(list);
    panel.appendChild(missing);
    layout.appendChild(canvas);
    layout.appendChild(panel);
    shell.appendChild(layout);
    return shell;
  }

  // ---- Alla dagar ---------------------------------------------------------
  // Varje dag får en sektion med sin flödeslista (Flöde-vyn). Programguiden och
  // kartan läggs sist och visas bara när respektive vy är aktiv.
  function renderDays() {
    const main = document.getElementById('mv-days');
    if (!main) return;
    main.textContent = '';
    (DATA.days || []).forEach(d => {
      const sec = el('section', 'day');
      sec.id = 'day-' + d.date;
      const h2 = document.createElement('h2'); h2.textContent = d.title; sec.appendChild(h2);
      sec.appendChild(buildFlowList(d));
      main.appendChild(sec);
    });
    main.appendChild(buildMergedGuideBoard());
    main.appendChild(buildMapView());
  }

  renderNav();
  renderToolbar();
  renderDays();
})();


/* --------------------------------------------------------------------------
 * VIEW – vy-växlare (Flöde / Programguide / Karta)
 *
 * Läget sparas i localStorage och speglas i body[data-view]. Flöde och
 * programguide flyttar samma eventnoder mellan listor/rader så all befintlig
 * wiring följer med oförändrad; kartan läser eventnoderna utan att flytta dem.
 * ------------------------------------------------------------------------ */
(function () {
  const VIEW_KEY = 'mv_view_v1';
  const VIEWS = [
    { id: 'flow',   icon: '\uD83D\uDCC5', label: 'Flöde' },
    { id: 'guide',  icon: '\uD83D\uDDBC\uFE0F', label: 'Programguide' },
    { id: 'map',    icon: '\uD83D\uDDFA\uFE0F', label: 'Karta' },
  ];
  const ids = VIEWS.map(v => v.id);
  const bar = document.getElementById('mv-viewbar');
  function load() {
    try { const v = localStorage.getItem(VIEW_KEY); return ids.indexOf(v) !== -1 ? v : 'flow'; }
    catch (e) { return 'flow'; }
  }
  function store(v) { try { localStorage.setItem(VIEW_KEY, v); } catch (e) {} }
  let mode = load();

  function applyMode() {
    document.body.dataset.view = mode;
    if (bar) bar.querySelectorAll('.vbtn').forEach(b =>
      b.setAttribute('aria-pressed', b.dataset.view === mode ? 'true' : 'false'));
    moveTo(mode);
    if (mode === 'map' && window.MVMAP) window.MVMAP.activate();
  }

  function show(target) {
    if (ids.indexOf(target) === -1) return false;
    if (mode !== target) {
      mode = target;
      store(mode);
      applyMode();
    } else if (mode === 'map' && window.MVMAP) {
      window.MVMAP.activate();
    }
    return true;
  }

  // Flytta (inte återskapa) event-noderna mellan flöde och programguide.
  let placed = 'flow';
  const GUIDE_ROW_H = 78;
  const GUIDE_MIN_W = 150;

  function guideTrack(date) {
    return document.querySelector('.merged-guide .guide-track-inner[data-date="' + date + '"]');
  }

  function clearGuidePlacement(node) {
    node.style.left = '';
    node.style.top = '';
    node.style.width = '';
    node.style.height = '';
  }

  function placeGuideDay(date, nodes) {
    const track = guideTrack(date);
    if (!track) return;
    const dayStart = +track.dataset.dayStart || 0;
    const px = +track.dataset.px || 1.55;
    const visible = nodes.filter(n => !n.classList.contains('hidden'));
    visible.sort((a, b) =>
      (+a.dataset.s - +b.dataset.s) || (+a.dataset.e - +b.dataset.e) ||
      (a.dataset.title < b.dataset.title ? -1 : 1));

    const laneEnds = [];
    visible.forEach(node => {
      const s = +node.dataset.s || 0;
      const e = +node.dataset.e || s + 30;
      const visualEnd = Math.max(e, s + Math.ceil(GUIDE_MIN_W / px));
      let lane = laneEnds.findIndex(end => end <= s);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(visualEnd);
      } else {
        laneEnds[lane] = visualEnd;
      }
      node.style.left = Math.round((s - dayStart) * px) + 'px';
      node.style.top = (lane * GUIDE_ROW_H + 6) + 'px';
      node.style.width = Math.max(GUIDE_MIN_W, Math.round((e - s) * px) - 4) + 'px';
      node.style.height = (GUIDE_ROW_H - 12) + 'px';
    });

    const rows = Math.max(laneEnds.length, visible.length ? 1 : 0);
    track.style.height = Math.max(84, rows * GUIDE_ROW_H + 8) + 'px';
  }

  function reflowGuide() {
    if (mode !== 'guide') return;
    const byDay = {};
    document.querySelectorAll('.guide-track-inner .event').forEach(n => {
      (byDay[n.dataset.date] = byDay[n.dataset.date] || []).push(n);
    });
    Object.keys(byDay).forEach(date => placeGuideDay(date, byDay[date]));
  }

  function moveTo(target) {
    if (target === 'map') {
      if (window.MVFILTER) window.MVFILTER.apply();
      return;
    }
    if (placed === target) return;
    const nodes = Array.prototype.slice.call(document.querySelectorAll('.event'));
    if (target === 'flow') {
      // Gruppera per dag och lägg tillbaka kronologiskt i varje dags lista.
      const byDay = {};
      nodes.forEach(n => { (byDay[n.dataset.date] = byDay[n.dataset.date] || []).push(n); });
      Object.keys(byDay).forEach(date => {
        const sec = document.getElementById('day-' + date);
        const list = sec ? sec.querySelector('.flow-list') : null;
        if (!list) return;
        byDay[date].sort((a, b) =>
          (+a.dataset.s - +b.dataset.s) || (+a.dataset.e - +b.dataset.e) ||
          (a.dataset.title < b.dataset.title ? -1 : 1));
        byDay[date].forEach(n => {
          clearGuidePlacement(n);
          list.appendChild(n);
        });
      });
    } else if (target === 'guide') {
      const byDay = {};
      nodes.forEach(n => { (byDay[n.dataset.date] = byDay[n.dataset.date] || []).push(n); });
      Object.keys(byDay).forEach(date => {
        const track = guideTrack(date);
        if (!track) return;
        byDay[date].sort((a, b) =>
          (+a.dataset.s - +b.dataset.s) || (+a.dataset.e - +b.dataset.e) ||
          (a.dataset.title < b.dataset.title ? -1 : 1));
        byDay[date].forEach(n => track.appendChild(n));
        placeGuideDay(date, byDay[date]);
      });
    }
    placed = target;
    if (window.MV) window.MV.syncAll();
    if (window.MVFILTER) window.MVFILTER.apply();
  }

  function render() {
    if (!bar) return;
    const sw = document.createElement('div');
    sw.className = 'viewswitch';
    sw.setAttribute('role', 'group');
    sw.setAttribute('aria-label', 'Välj vy');
    VIEWS.forEach(v => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'vbtn';
      b.dataset.view = v.id;
      b.innerHTML = "<span aria-hidden='true'>" + v.icon + '</span> ' + v.label;
      b.addEventListener('click', () => {
        show(v.id);
      });
      sw.appendChild(b);
    });
    bar.appendChild(sw);
  }

  render();
  applyMode();
  window.MVVIEW = { reflowGuide: reflowGuide, show: show };
})();


/* --------------------------------------------------------------------------
 * STATE – favoriter, köpta biljetter, dölj (en/alla), localStorage
 * ------------------------------------------------------------------------ */
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
    const tixmark = el.querySelector('.tixmark');
    if (tixmark){ tixmark.classList.toggle('bought', buy);
      tixmark.title = buy ? 'Biljett köpt' : 'Det här eventet kräver biljett'; }
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
    const hideBtn = ev.target.closest('.event-hide');
    if (hideBtn) {
      ev.preventDefault();
      ev.stopPropagation();
      const host = hideBtn.closest('.event');
      if (host && window.MV) window.MV.requestHide(host.dataset.id);
      return;
    }

    const btn = ev.target.closest('.event-actions .act');
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    const host = btn.closest('.event');
    if (host && btn.classList.contains('fav')) toggleFav(host.dataset.id);
  });

  syncAll();
})();


/* --------------------------------------------------------------------------
 * HIDE – stilad dialog för att dölja/visa en eller alla förekomster
 * ------------------------------------------------------------------------ */
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


/* --------------------------------------------------------------------------
 * SCRIPT – sök, filter (kategori/plats), bara favoriter, visa dolda
 * ------------------------------------------------------------------------ */
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
    // Dölj tomma dagar: räkna synliga event per datum globalt (noderna kan ligga
    // i flödeslistor eller programguiden beroende på vy).
    const seenDate = {};
    for (const el of events) if (!el.classList.contains('hidden')) seenDate[el.dataset.date] = true;
    document.querySelectorAll('section.day').forEach(day => {
      const date = day.id.replace(/^day-/, '');
      const any = !!seenDate[date];
      day.classList.toggle('empty', !any);
      document.querySelectorAll('a.daylink[href="#' + day.id + '"]').forEach(link =>
        link.classList.toggle('empty', !any));
      const gday = document.querySelector('.guide-day[data-date="' + date + '"]');
      if (gday) gday.classList.toggle('hidden', !any);
    });
    if (window.MVVIEW) window.MVVIEW.reflowGuide();
    if (window.MVMAP) window.MVMAP.refresh();
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
  window.MVFILTER = { apply: apply };
  apply();
})();


/* --------------------------------------------------------------------------
 * MODAL – detaljvy när man klickar på ett event
 * ------------------------------------------------------------------------ */
(function () {
  const modal = document.getElementById('modal');
  if (!modal) return;
  const mTitle = document.getElementById('m-title');
  const mMeta = document.getElementById('m-meta');
  const mBadges = document.getElementById('m-badges');
  const mDesc = document.getElementById('m-desc');
  const mMapLinks = document.getElementById('m-maplinks');
  const mMap = document.getElementById('m-map');
  const mDirections = document.getElementById('m-directions');
  const mOccurrences = document.getElementById('m-occurrences');
  const mTicket = document.getElementById('m-ticket');
  const mFav = document.getElementById('m-fav');
  const mBought = document.getElementById('m-bought');
  const mHide = document.getElementById('m-hide');
  let currentId = null, currentTicketed = false, currentTitle = '';
  let currentMapEvent = null;

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
    mBought.textContent = '';
    mBought.appendChild(mvTicketIcon('tix'));
    mBought.appendChild(document.createTextNode(buy ? ' Biljett k\u00f6pt' : ' Markera biljett som k\u00f6pt'));
    mBought.classList.toggle('on', buy);
    const hid = currentId ? window.MV.isHidden(currentId) : false;
    mHide.textContent = hid ? '\u21a9 Visa eventet igen' : '\u2715 D\u00f6lj event';
    mHide.classList.toggle('on', hid);
    syncOccurrences();
  }

  function dayTitle(date) {
    const sec = document.getElementById('day-' + date);
    const h = sec ? sec.querySelector('h2') : null;
    return h ? h.textContent.trim() : date;
  }

  function matchingOccurrences(title, excludeId) {
    return Array.from(document.querySelectorAll('.event'))
      .filter(ev => ev.dataset.title === title && ev.dataset.id !== excludeId)
      .sort((a, b) =>
        (a.dataset.date || '').localeCompare(b.dataset.date || '') ||
        (+a.dataset.s - +b.dataset.s) ||
        (a.dataset.venue || '').localeCompare(b.dataset.venue || '', 'sv'));
  }

  function syncOccurrences() {
    if (!mOccurrences || !window.MV) return;
    mOccurrences.querySelectorAll('.occ-fav').forEach(btn => {
      const id = btn.dataset.id || '';
      const fav = !!id && window.MV.isFav(id);
      btn.classList.toggle('on', fav);
      btn.setAttribute('aria-pressed', fav ? 'true' : 'false');
      btn.textContent = fav ? '\u2605' : '\u2606';
      btn.title = fav ? 'Ta bort favorit' : 'Markera som favorit';
    });
  }

  function renderOccurrences() {
    if (!mOccurrences) return;
    mOccurrences.textContent = '';
    const rows = currentTitle ? matchingOccurrences(currentTitle, currentId) : [];
    if (!rows.length) {
      mOccurrences.hidden = true;
      return;
    }
    mOccurrences.hidden = false;
    const h = document.createElement('h4');
    h.textContent = 'Andra tillfällen';
    mOccurrences.appendChild(h);
    const list = document.createElement('div');
    list.className = 'occ-list';
    rows.forEach(ev => {
      const row = document.createElement('div');
      row.className = 'occ-row';

      const when = document.createElement('div');
      when.className = 'occ-when';
      const d = document.createElement('span');
      d.className = 'occ-date';
      d.textContent = dayTitle(ev.dataset.date || '');
      const t = document.createElement('span');
      t.className = 'occ-time';
      t.textContent = ev.dataset.time || '';
      when.appendChild(d);
      when.appendChild(t);

      const where = document.createElement('div');
      where.className = 'occ-where';
      where.textContent = ev.dataset.venue || '';

      const fav = document.createElement('button');
      fav.type = 'button';
      fav.className = 'occ-fav';
      fav.dataset.id = ev.dataset.id || '';
      fav.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        if (window.MV && fav.dataset.id) window.MV.toggleFav(fav.dataset.id);
      });

      row.appendChild(when);
      row.appendChild(where);
      row.appendChild(fav);
      list.appendChild(row);
    });
    mOccurrences.appendChild(list);
    syncOccurrences();
  }

  function openFor(el) {
    currentId = el.dataset.id || null;
    currentTicketed = !!el.dataset.ticket;
    currentTitle = el.dataset.title || '';
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

    const lat = el.dataset.lat;
    const lng = el.dataset.lng;
    if (mMapLinks && mMap && mDirections && lat && lng) {
      const coords = encodeURIComponent(lat + ',' + lng);
      currentMapEvent = el;
      mDirections.href = 'https://www.google.com/maps/dir/?api=1&destination=' + coords;
      mMapLinks.hidden = false;
    } else if (mMapLinks) {
      currentMapEvent = null;
      if (mDirections) mDirections.removeAttribute('href');
      mMapLinks.hidden = true;
    }

    if (el.dataset.ticket) { mTicket.href = el.dataset.ticket; mTicket.hidden = false; }
    else { mTicket.removeAttribute('href'); mTicket.hidden = true; }

    renderOccurrences();
    refreshActions();
    modal.hidden = false;
  }
  function close() { modal.hidden = true; }

  document.querySelectorAll('.event').forEach(el => {
    el.addEventListener('click', ev => {
      if (ev.target.closest('a') || ev.target.closest('.event-actions') || ev.target.closest('.event-hide')) return;
      openFor(el);
    });
  });
  modal.addEventListener('click', ev => { if (ev.target === modal) close(); });
  document.getElementById('m-close').addEventListener('click', close);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !modal.hidden) close(); });
  if (mMap) mMap.addEventListener('click', () => {
    if (!currentMapEvent) return;
    if (window.MVVIEW) window.MVVIEW.show('map');
    if (window.MVMAP) window.MVMAP.selectEvent(currentMapEvent);
    close();
  });
  mFav.addEventListener('click', () => { if (window.MV && currentId) window.MV.toggleFav(currentId); });
  mBought.addEventListener('click', () => { if (window.MV && currentId) window.MV.toggleBought(currentId); });
  mHide.addEventListener('click', () => {
    if (!window.MV || !currentId) return;
    window.MV.requestHide(currentId, { onHidden: close });
  });
  if (window.MV) window.MV.onChange(refreshActions);
  window.MVMODAL = { open: openFor, close: close };
})();


/* --------------------------------------------------------------------------
 * MAP – kartvy med synliga, koordinatsatta platser
 * ------------------------------------------------------------------------ */
(function () {
  const shell = document.getElementById('mv-map-view');
  if (!shell) return;
  const canvas = document.getElementById('mv-map');
  const titleEl = document.getElementById('map-title');
  const countEl = document.getElementById('map-count');
  const placeToggle = document.getElementById('map-place-toggle');
  const placeChooser = placeToggle ? placeToggle.closest('.map-place-chooser') : null;
  const placesEl = document.getElementById('map-places');
  const listEl = document.getElementById('map-list');
  const missingEl = document.getElementById('map-missing');
  let map = null, layer = null, selectedKey = '', groups = [], missingCount = 0, placesOpen = false;
  const SELECT_ZOOM = 16;

  function dayTitle(date) {
    const sec = document.getElementById('day-' + date);
    const h = sec ? sec.querySelector('h2') : null;
    return h ? h.textContent.trim() : date;
  }

  function eventSort(a, b) {
    return (a.dataset.date || '').localeCompare(b.dataset.date || '') ||
      (+a.dataset.s - +b.dataset.s) ||
      (a.dataset.title || '').localeCompare(b.dataset.title || '', 'sv');
  }

  function collectGroups() {
    const byKey = {};
    let missing = 0;
    document.querySelectorAll('.event').forEach(el => {
      if (el.classList.contains('hidden')) return;
      const lat = Number(el.dataset.lat);
      const lng = Number(el.dataset.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        missing++;
        return;
      }
      const key = el.dataset.venue + '|' + lat + ',' + lng;
      const g = byKey[key] || (byKey[key] = {
        key: key, venue: el.dataset.venue || 'Okänd plats',
        lat: lat, lng: lng, events: [],
      });
      g.events.push(el);
    });
    const out = Object.values(byKey);
    out.forEach(g => g.events.sort(eventSort));
    out.sort((a, b) =>
      a.venue.localeCompare(b.venue, 'sv') ||
      eventSort(a.events[0], b.events[0]));
    missingCount = missing;
    return out;
  }

  function ensureMap() {
    if (map) return true;
    if (!canvas) return false;
    if (!window.L) {
      canvas.innerHTML = "<div class='map-fallback'>Kartan kunde inte laddas.</div>";
      return false;
    }
    map = L.map(canvas, { zoomControl: true, scrollWheelZoom: true })
      .setView([57.6425, 18.2965], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    return true;
  }

  function markerIcon(g, active) {
    return L.divIcon({
      className: 'mv-marker' + (active ? ' active' : ''),
      html: '<span>' + g.events.length + '</span>',
      iconSize: [34, 34],
      iconAnchor: [17, 17],
      popupAnchor: [0, -18],
    });
  }

  function renderMarkers(fit) {
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds = [];
    groups.forEach(g => {
      const marker = L.marker([g.lat, g.lng], {
        icon: markerIcon(g, g.key === selectedKey),
        title: g.venue,
      }).addTo(layer);
      const tip = document.createElement('span');
      tip.textContent = g.venue + ' (' + g.events.length + ')';
      marker.bindTooltip(tip);
      marker.on('click', () => select(g.key, true));
      bounds.push([g.lat, g.lng]);
    });
    if (fit && bounds.length) {
      map.fitBounds(bounds, { padding: [26, 26], maxZoom: 15 });
    }
  }

  function renderPlaces() {
    if (!placesEl) return;
    placesEl.textContent = '';
    groups.forEach(g => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'map-place';
      btn.classList.toggle('active', g.key === selectedKey);
      btn.textContent = g.venue + ' (' + g.events.length + ')';
      btn.addEventListener('click', () => {
        placesOpen = false;
        select(g.key, true);
      });
      placesEl.appendChild(btn);
    });
  }

  function renderPlaceChooser() {
    const selected = groups.find(g => g.key === selectedKey);
    if (placeToggle) {
      placeToggle.hidden = !groups.length;
      placeToggle.textContent = selected ? 'Byt plats' : 'Välj plats';
      placeToggle.setAttribute('aria-expanded', placesOpen ? 'true' : 'false');
    }
    if (placesEl) placesEl.hidden = !placesOpen || !groups.length;
  }

  function renderEventRow(el) {
    const row = document.createElement('div');
    row.className = 'map-event';
    const hidden = !!(window.MV && window.MV.isHiddenEl(el));
    row.classList.toggle('is-hidden', hidden);
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'map-event-main';
    open.addEventListener('click', () => {
      if (window.MVMODAL) window.MVMODAL.open(el);
    });

    const when = document.createElement('span');
    when.className = 'map-event-when';
    when.textContent = dayTitle(el.dataset.date || '') + ' · ' + (el.dataset.time || '');
    const title = document.createElement('span');
    title.className = 'map-event-title';
    title.textContent = el.dataset.title || '';
    const org = document.createElement('span');
    org.className = 'map-event-org';
    org.textContent = el.dataset.org || '';

    open.appendChild(when);
    open.appendChild(title);
    if (org.textContent) open.appendChild(org);

    const ticketed = !!el.dataset.ticket;
    let ticket = null;
    if (ticketed) {
      ticket = document.createElement('span');
      ticket.className = 'map-ticket';
      ticket.setAttribute('aria-hidden', 'true');
      const bought = !!(window.MV && window.MV.isBought(el.dataset.id));
      ticket.classList.toggle('bought', bought);
      ticket.title = bought ? 'Biljett köpt' : 'Det här eventet kräver biljett';
      ticket.appendChild(mvTicketIcon());
    }

    const fav = document.createElement('button');
    fav.type = 'button';
    fav.className = 'map-fav';
    fav.dataset.id = el.dataset.id || '';
    const on = !!(window.MV && window.MV.isFav(fav.dataset.id));
    fav.classList.toggle('on', on);
    fav.setAttribute('aria-pressed', on ? 'true' : 'false');
    fav.textContent = on ? '\u2605' : '\u2606';
    fav.title = on ? 'Ta bort favorit' : 'Markera som favorit';
    fav.addEventListener('click', () => {
      if (window.MV && fav.dataset.id) window.MV.toggleFav(fav.dataset.id);
    });

    const hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'map-hide';
    hide.title = hidden ? 'Visa eventet igen' : 'Dölj event';
    hide.setAttribute('aria-label', hidden ? 'Visa eventet igen' : 'Dölj event');
    hide.textContent = '\u00d7';
    hide.addEventListener('click', () => {
      if (window.MV && el.dataset.id) window.MV.requestHide(el.dataset.id);
    });

    row.appendChild(open);
    if (ticket) row.appendChild(ticket);
    row.appendChild(fav);
    row.appendChild(hide);
    return row;
  }

  function renderPanel() {
    const selected = groups.find(g => g.key === selectedKey);
    const total = groups.reduce((sum, g) => sum + g.events.length, 0);
    if (titleEl) titleEl.textContent = selected ? selected.venue : 'Karta';
    if (countEl) {
      countEl.textContent = groups.length
        ? groups.length + ' platser · ' + total + ' programpunkter'
        : 'Inga programpunkter';
    }
    if (listEl) {
      listEl.textContent = '';
      if (selected) selected.events.forEach(el => listEl.appendChild(renderEventRow(el)));
      else {
        const empty = document.createElement('div');
        empty.className = 'map-empty';
        empty.textContent = 'Inga synliga programpunkter med kartposition.';
        listEl.appendChild(empty);
      }
    }
    if (missingEl) {
      missingEl.hidden = missingCount === 0;
      missingEl.textContent = missingCount
        ? missingCount + (missingCount === 1 ? ' synlig programpunkt saknar kartposition.' :
          ' synliga programpunkter saknar kartposition.')
        : '';
    }
    renderPlaces();
    renderPlaceChooser();
  }

  function select(key, pan) {
    if (!groups.some(g => g.key === key)) return false;
    selectedKey = key;
    renderPanel();
    renderMarkers(false);
    const selected = groups.find(g => g.key === selectedKey);
    if (pan && map && selected) {
      const zoom = Math.max(map.getZoom() || SELECT_ZOOM, SELECT_ZOOM);
      map.setView([selected.lat, selected.lng], zoom, { animate: true });
    }
    return true;
  }

  function refresh(opts) {
    opts = opts || {};
    groups = collectGroups();
    if (!groups.some(g => g.key === selectedKey)) selectedKey = groups[0] ? groups[0].key : '';
    if (!groups.length) placesOpen = false;
    renderPanel();
    if (document.body.dataset.view === 'map') ensureMap();
    renderMarkers(opts.fit !== false);
  }

  function activate() {
    if (!ensureMap()) {
      refresh({ fit: false });
      return;
    }
    refresh({ fit: true });
    setTimeout(() => {
      if (map) {
        map.invalidateSize();
        renderMarkers(true);
      }
    }, 60);
  }

  function selectDate(date) {
    if (!groups.length) refresh({ fit: false });
    const g = groups.find(group => group.events.some(el => el.dataset.date === date));
    return g ? select(g.key, true) : false;
  }

  function selectEvent(el) {
    if (!el) return false;
    const lat = Number(el.dataset.lat);
    const lng = Number(el.dataset.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    const key = (el.dataset.venue || 'Okänd plats') + '|' + lat + ',' + lng;
    refresh({ fit: false });
    return select(key, true);
  }

  if (placeToggle) {
    placeToggle.addEventListener('click', () => {
      placesOpen = !placesOpen;
      renderPlaceChooser();
    });
  }
  document.addEventListener('click', ev => {
    if (!placesOpen || !placeChooser || placeChooser.contains(ev.target)) return;
    placesOpen = false;
    renderPlaceChooser();
  });

  if (window.MV) window.MV.onChange(() => refresh({ fit: false }));
  window.MVMAP = {
    activate: activate,
    refresh: refresh,
    selectDate: selectDate,
    selectEvent: selectEvent,
  };
  refresh({ fit: false });
})();


/* --------------------------------------------------------------------------
 * PRINT – utskriftsvänlig favoritlista
 * ------------------------------------------------------------------------ */
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
    // Event-noderna kan ligga i flödeslistor eller programguiden, så
    // samla globalt och gruppera per datum (oberoende av aktiv vy).
    const byDate = {};
    document.querySelectorAll('.event').forEach(el => {
      if (!window.MV || !window.MV.isFav(el.dataset.id)) return;
      const date = el.dataset.date || '';
      (byDate[date] = byDate[date] || []).push({
        s: +el.dataset.s,
        time: el.dataset.time || '',
        title: el.dataset.title || '',
        venue: el.dataset.venue || '',
        org: el.dataset.org || '',
        ticket: !!el.dataset.ticket,
        bought: window.MV.isBought(el.dataset.id),
      });
    });
    const days = [];
    Object.keys(byDate).sort().forEach(date => {
      const rows = byDate[date];
      rows.sort((a, b) => a.s - b.s || a.title.localeCompare(b.title, 'sv'));
      const sec = document.getElementById('day-' + date);
      const h = sec ? sec.querySelector('h2') : null;
      days.push({ heading: h ? h.textContent.trim() : date, rows: rows });
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


/* --------------------------------------------------------------------------
 * CALENDAR – ladda ner favoriter som .ics (bygger även window.MVICS)
 * ------------------------------------------------------------------------ */
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
    document.querySelectorAll('.event').forEach(el => {
      if (!window.MV || !window.MV.isFav(el.dataset.id)) return;
      items.push({
        id: el.dataset.id, date: el.dataset.date || '', s: +el.dataset.s, e: +el.dataset.e,
        title: el.dataset.title || '', venue: el.dataset.venue || '',
        org: el.dataset.org || '', cat: el.dataset.cat || '',
        desc: el.dataset.desc || '', ticket: el.dataset.ticket || '',
        bought: window.MV.isBought(el.dataset.id),
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


/* --------------------------------------------------------------------------
 * SYNC – prenumeration (Cloudflare Worker), sparar favorit-id:n
 * ------------------------------------------------------------------------ */
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


/* --------------------------------------------------------------------------
 * HELP – kom-igång-hjälp för nya användare
 *
 * Öppnas via "❓ Hjälp" under Mer-knappen, och automatiskt EN gång vid första
 * besöket (flaggan sparas i localStorage). Stängs med knapp, kryss, Esc eller
 * klick utanför.
 * ------------------------------------------------------------------------ */
(function () {
  const SEEN_KEY = 'mv_helpseen_v1';
  const dlg = document.getElementById('helpdlg');
  if (!dlg) return;
  const btn = document.getElementById('helpBtn');
  const xBtn = document.getElementById('help-x');
  const okBtn = document.getElementById('help-ok');

  function markSeen() { try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {} }
  function seen() { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return true; } }

  function open() {
    // Visa bara första steget uppfällt så rutan inte känns överväldigande.
    const secs = dlg.querySelectorAll('.help-sec');
    secs.forEach((s, i) => { s.open = i === 0; });
    dlg.hidden = false; markSeen();
  }
  function close() { dlg.hidden = true; }

  if (btn) btn.addEventListener('click', open);
  if (xBtn) xBtn.addEventListener('click', close);
  if (okBtn) okBtn.addEventListener('click', close);
  dlg.addEventListener('click', ev => { if (ev.target === dlg) close(); });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && !dlg.hidden) close();
  });

  // Första besöket: visa hjälpen självmant (aldrig igen efter det).
  if (!seen()) open();

  window.MVHELP = { open: open, close: close };
})();

