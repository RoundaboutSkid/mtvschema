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
(function () {
  const DATA = (typeof window !== 'undefined' && window.MV_DATA) || {};
  window.MV_CFG = { icsEndpoint: DATA.icsEndpoint || '' };

  const TICKET_SVG = "<svg class='tix' viewBox='0 0 24 24' aria-hidden='true'>" +
    "<rect x='3' y='6' width='13' height='12' rx='2.5'/>" +
    "<rect x='18' y='6' width='3' height='12' rx='1.5'/></svg>";

  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
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
      "<button class='reset' id='unhideAll' title='Visa alla dolda event igen' style='display:none'>↩ Visa alla dolda</button>" +
      "<button class='reset' id='printFav' title='Öppna en utskriftsvänlig lista över dina favoriter'>★ Skriv ut favoriter</button>" +
      "<button class='reset' id='icsFav' title='Ladda ner dina favoriter som en kalenderfil (.ics)'>📅 Lägg till i kalender</button>" +
      subBtn +
      "<button class='reset' id='reset'>Återställ</button>" +
      "<span class='count' id='count'></span>";

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
  }

  // ---- Ett event-block ----------------------------------------------------
  function buildEvent(ev) {
    const n = el('div', 'event' + (ev.short ? ' short' : ''));
    n.style.cssText = 'top:' + ev.top + 'px;height:' + ev.height + 'px;left:' + ev.left +
      '%;width:calc(' + ev.width + '% - 3px);background:#' + ev.color + ';';
    n.title = ev.tooltip || '';
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
    // Två uppsättningar lane-positioner: plats (v) och zon (z). VIEW växlar mellan dem.
    n.setAttribute('data-vleft', ev.left);
    n.setAttribute('data-vwidth', ev.width);
    if (ev.zLeft != null) n.setAttribute('data-zleft', ev.zLeft);
    if (ev.zWidth != null) n.setAttribute('data-zwidth', ev.zWidth);
    n.setAttribute('data-zone', ev.zone || 'Z?');

    const t = el('span', 't'); t.textContent = ev.time; n.appendChild(t);
    const ttl = el('span', 'ttl'); ttl.textContent = ev.title; n.appendChild(ttl);
    if (ev.orgShow && ev.org) {
      const o = el('span', 'org'); o.textContent = ev.org; n.appendChild(o);
    }
    // Plats-etikett (ikon + plats) – visas bara i zon-vyn där kolumnen blandar platser.
    const place = el('span', 'ev-place');
    place.textContent = (ev.icon ? ev.icon + ' ' : '') + (ev.venue || '');
    n.appendChild(place);

    if (ev.cat || ev.status) {
      const meta = el('div', 'meta');
      if (ev.cat) {
        const b = el('span', 'badge'); b.textContent = ev.cat; meta.appendChild(b);
      }
      if (ev.status) {
        if (ev.ticket) {
          const a = el('a', 'badge ticket');
          a.href = ev.ticket; a.target = '_blank'; a.rel = 'noopener';
          a.textContent = ev.status + ' ↗';
          meta.appendChild(a);
        } else {
          const s = el('span', 'badge'); s.textContent = ev.status; meta.appendChild(s);
        }
      }
      n.appendChild(meta);
    }

    const acts = el('div', 'event-actions');
    const warn = el('span', 'warn');
    warn.title = 'Favorit med biljett – inte markerad som köpt';
    warn.textContent = '!'; acts.appendChild(warn);
    if (ev.ticket) {
      const bought = el('button', 'act bought');
      bought.type = 'button'; bought.setAttribute('aria-pressed', 'false');
      bought.title = 'Markera att du köpt biljett';
      bought.innerHTML = TICKET_SVG; acts.appendChild(bought);
    }
    const fav = el('button', 'act fav');
    fav.type = 'button'; fav.setAttribute('aria-pressed', 'false');
    fav.title = 'Markera som favorit'; fav.textContent = '★'; acts.appendChild(fav);
    const hide = el('button', 'act hide');
    hide.type = 'button'; hide.setAttribute('aria-pressed', 'false');
    hide.title = 'Dölj det här eventet'; hide.textContent = '✕'; acts.appendChild(hide);
    const info = el('span', 'info'); info.setAttribute('aria-hidden', 'true');
    info.textContent = 'i'; acts.appendChild(info);
    n.appendChild(acts);
    return n;
  }

  // ---- En dags tavla ------------------------------------------------------
  function buildBoard(d) {
    const scroll = el('div', 'board-scroll');
    const board = el('div', 'board');
    board.setAttribute('data-day-start', d.dayStart);
    board.setAttribute('data-day-end', d.dayEnd);
    board.setAttribute('data-slot', d.slot);
    board.setAttribute('data-px', d.px);
    board.style.setProperty('--slot-px', d.slotPx + 'px');

    const axis = el('div', 'axis-col');
    const ah = el('div', 'axis-head'); ah.textContent = 'Tid'; axis.appendChild(ah);
    const ab = el('div', 'axis-body');
    ab.style.height = 'calc(var(--vis,' + d.trackH + 'px) + 2 * var(--board-pad))';
    const ai = el('div', 'axis-inner'); ai.style.height = d.trackH + 'px';
    (d.ticks || []).forEach(tk => {
      const t = el('div', 'tick' + (tk.hour ? ' hour' : ''));
      t.style.top = tk.top + 'px'; t.textContent = tk.label;
      ai.appendChild(t);
    });
    ab.appendChild(ai); axis.appendChild(ab); board.appendChild(axis);

    (d.venues || []).forEach(v => {
      const col = el('div', 'venue-col');
      col.setAttribute('data-venue', v.venue);
      col.style.minWidth = v.minW + 'px';
      const vh = el('div', 'venue-head'); vh.title = v.venue; vh.textContent = v.venue;
      col.appendChild(vh);
      const track = el('div', 'track');
      const ti = el('div', 'track-inner'); ti.style.height = d.trackH + 'px';
      (v.events || []).forEach(ev => ti.appendChild(buildEvent(ev)));
      track.appendChild(ti); col.appendChild(track); board.appendChild(col);
    });

    // Zon-kolumner (tomma) – VIEW flyttar in event-noderna när zon-vyn aktiveras.
    (d.zones || []).forEach(z => {
      const col = el('div', 'zone-col');
      col.setAttribute('data-zone', z.id);
      col.style.minWidth = z.minW + 'px';
      const zh = el('div', 'zone-head'); zh.style.background = '#' + z.color; zh.title = z.label;
      const nm = el('span', 'zname'); nm.textContent = z.label; zh.appendChild(nm);
      if (z.icons && z.icons.length) {
        const ic = el('span', 'zicons'); ic.textContent = z.icons.join(''); zh.appendChild(ic);
      }
      col.appendChild(zh);
      const track = el('div', 'track');
      const ti = el('div', 'track-inner'); ti.style.height = d.trackH + 'px';
      track.appendChild(ti); col.appendChild(track); board.appendChild(col);
    });

    // Plats-kolumner (alla platser, veckomax-bredd) – samma uppsättning och bredd
    // varje dag så en plats håller samma x-position ("spola i tiden"). VIEW flyttar
    // in event-noderna när Alla platser-vyn aktiveras; tomma kolumner står kvar.
    (DATA.places || []).forEach(pl => {
      const col = el('div', 'places-col');
      col.setAttribute('data-venue', pl.venue);
      col.dataset.wFull = pl.minW;
      col.dataset.wCompact = pl.minWc || pl.minW;
      col.style.flex = '0 0 ' + pl.minW + 'px';
      col.style.width = pl.minW + 'px';
      const vh = el('div', 'venue-head'); vh.title = pl.venue;
      vh.textContent = (pl.icon ? pl.icon + ' ' : '') + pl.venue;
      col.appendChild(vh);
      const track = el('div', 'track');
      const ti = el('div', 'track-inner'); ti.style.height = d.trackH + 'px';
      track.appendChild(ti); col.appendChild(track); board.appendChild(col);
    });

    scroll.appendChild(board);
    return scroll;
  }

  // ---- Alla dagar ---------------------------------------------------------
  function renderDays() {
    const main = document.getElementById('mv-days');
    if (!main) return;
    main.textContent = '';
    (DATA.days || []).forEach(d => {
      const sec = el('section', 'day');
      sec.id = 'day-' + d.date;
      const h2 = document.createElement('h2'); h2.textContent = d.title; sec.appendChild(h2);
      sec.appendChild(buildBoard(d));
      main.appendChild(sec);
    });
  }

  renderNav();
  renderToolbar();
  renderDays();
})();


/* --------------------------------------------------------------------------
 * VIEW – vy-växlare (Flöde / Zon-band / Alla platser)
 *
 * Läget sparas i localStorage och speglas i body[data-view]. Varje vy har sin
 * egen uppsättning kolumner i tavlan; moveTo() flyttar (inte återskapar) event-
 * noderna till rätt kolumntyp så all befintlig wiring följer med oförändrad.
 * ------------------------------------------------------------------------ */
(function () {
  const VIEW_KEY = 'mv_view_v1';
  const VIEWS = [
    { id: 'flow',   icon: '\uD83D\uDCC5', label: 'Flöde' },
    { id: 'zones',  icon: '\uD83E\uDDED', label: 'Zon-band' },
    { id: 'places', icon: '\uD83D\uDDC2\uFE0F', label: 'Alla platser' },
  ];
  const ids = VIEWS.map(v => v.id);
  const bar = document.getElementById('mv-viewbar');
  function load() {
    try { const v = localStorage.getItem(VIEW_KEY); return ids.indexOf(v) !== -1 ? v : 'flow'; }
    catch (e) { return 'flow'; }
  }
  function store(v) { try { localStorage.setItem(VIEW_KEY, v); } catch (e) {} }
  let mode = load();

  // Kompakt-läge: smalare platskolumner (gäller bara Alla platser-vyn).
  const COMPACT_KEY = 'mv_compact_v1';
  function loadCompact() { try { return localStorage.getItem(COMPACT_KEY) === '1'; } catch (e) { return false; } }
  let compact = loadCompact();
  let compactBtn = null;
  function applyCompact() {
    document.body.dataset.compact = compact ? '1' : '0';
    document.querySelectorAll('.places-col').forEach(col => {
      const w = (compact ? col.dataset.wCompact : col.dataset.wFull) || col.dataset.wFull;
      if (w) { col.style.flex = '0 0 ' + w + 'px'; col.style.width = w + 'px'; }
    });
    if (compactBtn) compactBtn.setAttribute('aria-pressed', compact ? 'true' : 'false');
  }

  function applyMode() {
    document.body.dataset.view = mode;
    if (bar) bar.querySelectorAll('.vbtn').forEach(b =>
      b.setAttribute('aria-pressed', b.dataset.view === mode ? 'true' : 'false'));
    if (compactBtn) compactBtn.hidden = (mode !== 'places');
    moveTo(mode);
    if (mode === 'places') applyCompact();
  }

  // Flytta (inte återskapa) event-noderna mellan plats-, zon- och alla-platser-
  // kolumner så att all befintlig wiring (favoriter, modal, filter) följer med.
  let placed = 'flow';
  function placeEvent(node, target) {
    const zone = target === 'zones';
    const L = zone ? node.dataset.zleft : node.dataset.vleft;
    const W = zone ? node.dataset.zwidth : node.dataset.vwidth;
    if (L != null) node.style.left = L + '%';
    if (W != null) node.style.width = 'calc(' + W + '% - 3px)';
  }
  function destFor(day, target, node) {
    if (target === 'zones')
      return day.querySelector('.zone-col[data-zone="' + (node.dataset.zone || 'Z?') + '"] .track-inner');
    const sel = target === 'places' ? '.places-col' : '.venue-col';
    return day.querySelector(sel + '[data-venue="' + node.dataset.venue + '"] .track-inner');
  }
  function moveTo(target) {
    if (placed === target) return;
    document.querySelectorAll('section.day').forEach(day => {
      day.querySelectorAll('.event').forEach(node => {
        const dest = destFor(day, target, node);
        if (dest) { dest.appendChild(node); placeEvent(node, target); }
      });
    });
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
        if (mode === v.id) return;
        mode = v.id; store(mode); applyMode();
      });
      sw.appendChild(b);
    });
    bar.appendChild(sw);

    compactBtn = document.createElement('button');
    compactBtn.type = 'button';
    compactBtn.className = 'vtoggle';
    compactBtn.hidden = true;
    compactBtn.setAttribute('aria-pressed', compact ? 'true' : 'false');
    compactBtn.title = 'Smalare kolumner – mindre sidoskroll';
    compactBtn.innerHTML = "<span aria-hidden='true'>\u2194</span> Kompakt";
    compactBtn.addEventListener('click', () => {
      compact = !compact;
      try { localStorage.setItem(COMPACT_KEY, compact ? '1' : '0'); } catch (e) {}
      applyCompact();
    });
    bar.appendChild(compactBtn);
  }

  render();
  applyMode();
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
    // Hide zone columns with no visible events (zon-band-vyn).
    document.querySelectorAll('.zone-col').forEach(col => {
      const hasVisible = col.querySelector('.event:not(.hidden)') !== null;
      col.classList.toggle('hidden', !hasVisible);
    });
    // Alla platser-vyn: dölj en kolumn bara när platsen är bortfiltrerad. Tomma men
    // ikryssade kolumner står kvar så varje plats behåller samma x-position varje dag.
    document.querySelectorAll('.places-col').forEach(col => {
      col.classList.toggle('hidden', !activeVenues.has(col.dataset.venue));
    });
    // Hide days with no visible events (event-noderna ligger i aktiv vys kolumner).
    document.querySelectorAll('section.day').forEach(day => {
      const any = day.querySelector('.event:not(.hidden)') !== null;
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
