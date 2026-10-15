/** fmt.mjs — French, Brussels time, no surprises. */
export const TZ = 'Europe/Brussels';

const dLong  = new Intl.DateTimeFormat('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
const dShort = new Intl.DateTimeFormat('fr-BE', { day: 'numeric', month: 'short', timeZone: TZ });
const dTime  = new Intl.DateTimeFormat('fr-BE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

export function longDate(d) { return dLong.format(d instanceof Date ? d : new Date(d)); }
export function shortDate(d) { return dShort.format(d instanceof Date ? d : new Date(d)); }
export function clock(d) { return dTime.format(d instanceof Date ? d : new Date(d)); }

/** 'YYYY-MM-DD' (pi.js style) → '20 oct.'. Plain strings stay plain: no TZ shift. */
export function isoShort(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return dShort.format(new Date(+m[1], +m[2] - 1, +m[3]));
}

export function plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; }
export function pct(x) { return x == null ? '—' : Math.round(x * 100) + ' %'; }

/** Local-day key and midnight in Brussels time, whatever the server TZ. */
export function dayKey(ms = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const g = t => parts.find(p => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
export function localMidnight(ms = Date.now()) {
  // Walk back from `ms` until the day key changes: exact across DST without a TZ library.
  const key = dayKey(ms);
  let t = ms - (ms % 60000);
  while (dayKey(t - 60000) === key) t -= 60000;
  return t;
}
export function daysFromNow(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const target = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const todayKey = dayKey().split('-').map(Number);
  const today = Date.UTC(todayKey[0], todayKey[1] - 1, todayKey[2]);
  return Math.round((target - today) / 86400000);
}
