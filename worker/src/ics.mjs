// Pure iCalendar (.ics) builder for the Medeltidsveckan favourite calendar.
//
// This mirrors the in-browser CALENDAR_JS in build_schedule.py so the
// downloaded file and the subscribed feed produce identical output.
//
// An "item" has the shape:
//   { id, date, s, e, title, venue, org, cat, desc, ticket, bought }
// where s/e are minutes from midnight (e may exceed 1440 for past-midnight).

const PRODID = '-//Medeltidsveckan schema//SV';
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Stockholm',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST',
  'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET',
  'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
];

const pad = (n) => String(n).padStart(2, '0');

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

export function buildIcs(items) {
  const now = utcStamp(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:' + PRODID,
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Medeltidsveckan – mina favoriter',
    'X-WR-TIMEZONE:Europe/Stockholm'];
  VTIMEZONE.forEach((l) => lines.push(l));
  items.forEach((it) => {
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
