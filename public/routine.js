// A recurring routine, shared by the browser and the Worker.
//
//   12:00-12:20 Hygiene ! until done
//   12:30..14:00 Meal ! until photo; min 20m
//   sunset-1h..sunset Outing ! until away 30m, photo
//   02:30-12:00 Sleep !
//
// Blank lines and # notes are ignored. Starts roll past midnight after noon,
// like schedule.js. Windows open at their start and lock at their deadline.

export const MAX_LINES = 60;
export const MAX_NAME = 80;
export const DEFAULT_PLACE = { tz: 'Asia/Seoul', lat: 37.5665, lon: 126.978 };
export const DEFAULT_ROUTINE = `12:00-12:20 wake up, wash face, brush teeth ! until wake, done
12:30..14:00 lunch ! until photo; min 20m
14:00-sunset-1h free time
sunset-1h..sunset evening outing and dinner ! until away 30m, photo
sunset-02:00 free time
02:00-02:30 wash face, brush teeth ! until done
02:30-12:00 sleep !`;

const MINUTE = 60_000;
const DAY = 1440;
const TIME = '(?:\\d{1,2}:\\d{2}|sunset(?:[+-]\\d+(?:h(?:\\d+m)?|m))?)';
const WHEN = new RegExp(`^(${TIME})(?:(\\.\\.|-)(${TIME}))?$`);
const linesByItem = new WeakMap();
const formatters = new Map();
const midnightCache = new Map();
const offsetCache = new Map();
const sunsetCache = new Map();

/** A routine parse or placement failure with a 1-based source line. */
export class RoutineError extends Error {
  constructor(code, line = 0) {
    super(`${code}${line ? ` (line ${line})` : ''}`);
    this.code = code;
    this.line = line;
  }
}

function cached(map, key, calculate) {
  if (map.has(key)) return map.get(key);
  const value = calculate();
  if (map.size >= 4096) map.delete(map.keys().next().value);
  map.set(key, value);
  return value;
}

function parts(epoch, tz) {
  if (!formatters.has(tz)) {
    formatters.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }));
  }
  return Object.fromEntries(formatters.get(tz).formatToParts(epoch)
    .filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
}

/** The calendar date containing an epoch timestamp in the requested zone. */
export function zonedDate(epochMs, tz) {
  const p = parts(epochMs, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

function dateEpoch(date) {
  const epoch = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(epoch)
      || new Date(epoch).toISOString().slice(0, 10) !== date) {
    throw new RoutineError('badTime');
  }
  return epoch;
}

function addDate(date, days) {
  return new Date(dateEpoch(date) + days * DAY * MINUTE).toISOString().slice(0, 10);
}

function wallEpoch(epoch, tz) {
  const p = parts(epoch, tz);
  return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
}

function localTime(date, minutes, tz) {
  const nominal = dateEpoch(date) + minutes * MINUTE;
  const localDate = new Date(nominal).toISOString().slice(0, 10);
  const offsets = cached(offsetCache, `${tz}/${localDate}`, () => {
    const noon = dateEpoch(localDate) + 12 * 60 * MINUTE;
    return [...new Set([-1, 0, 1].map((day) => {
      const epoch = noon + day * DAY * MINUTE;
      return wallEpoch(epoch, tz) - epoch;
    }))];
  });
  if (offsets.length === 1) return nominal - offsets[0];
  const candidates = offsets.map((offset) => nominal - offset);
  const exact = candidates.filter((epoch) => wallEpoch(epoch, tz) === nominal);
  if (exact.length) return Math.min(...exact);
  // Compatible DST disambiguation: earlier occurrence in a fold, forward in a gap.
  const forward = candidates.filter((epoch) => wallEpoch(epoch, tz) >= nominal);
  if (forward.length) return Math.min(...forward);
  throw new RoutineError('badTime');
}

/** Epoch milliseconds of local midnight, including DST offset changes. */
export function zonedMidnight(date, tz) {
  return cached(midnightCache, `${tz}/${date}`, () => localTime(date, 0, tz));
}

/** NOAA sunset with zenith 90.833°, rounded to local clock minutes. */
export function sunsetMinutes(date, place = DEFAULT_PLACE) {
  return cached(sunsetCache, `${place.tz}/${place.lat}/${place.lon}/${date}`, () => solarMinutes(date, place));
}

function solarMinutes(date, place) {
  const epoch = dateEpoch(date);
  const year = Number(date.slice(0, 4));
  const n = Math.floor((epoch - Date.UTC(year, 0, 1)) / (DAY * MINUTE)) + 1;
  const radians = Math.PI / 180;
  const sin = (angle) => Math.sin(angle * radians);
  const cos = (angle) => Math.cos(angle * radians);
  const wrap = (value, period) => ((value % period) + period) % period;
  const longitudeHours = place.lon / 15;
  const t = n + (18 - longitudeHours) / 24;
  const mean = 0.9856 * t - 3.289;
  const longitude = wrap(mean + 1.916 * sin(mean) + 0.020 * sin(2 * mean) + 282.634, 360);
  let ascension = wrap(Math.atan(0.91764 * Math.tan(longitude * radians)) / radians, 360);
  ascension += Math.floor(longitude / 90) * 90 - Math.floor(ascension / 90) * 90;
  ascension /= 15;
  const declinationSin = 0.39782 * sin(longitude);
  const declinationCos = Math.cos(Math.asin(declinationSin));
  const hourCos = (cos(90.833) - declinationSin * sin(place.lat)) / (declinationCos * cos(place.lat));
  if (!Number.isFinite(hourCos) || Math.abs(hourCos) > 1) throw new RoutineError('badTime');
  const hour = Math.acos(hourCos) / radians / 15;
  const utcHours = wrap(hour + ascension - 0.06571 * t - 6.622 - longitudeHours, 24);
  const instant = epoch + Math.round(utcHours * 60) * MINUTE;
  // UTC may put the local sunset on a neighboring date (e.g. the Americas).
  const actualDate = zonedDate(instant, place.tz);
  const corrected = instant + (dateEpoch(date) - dateEpoch(actualDate));
  const p = parts(corrected, place.tz);
  return Number(p.hour) * 60 + Number(p.minute);
}

function duration(text, line, code, allowZero = false) {
  const match = text.match(/^(?:(\d+)h)?(?:(\d+)m)?$/);
  const minutes = match ? Number(match[1] || 0) * 60 + Number(match[2] || 0) : NaN;
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(minutes) || minutes < 0 || (!allowZero && minutes === 0)) {
    throw new RoutineError(code, line);
  }
  return minutes;
}

function time(token, line) {
  if (token.startsWith('sunset')) {
    if (token === 'sunset') return { base: 'sunset', minutes: 0 };
    return { base: 'sunset', minutes: (token[6] === '-' ? -1 : 1) * duration(token.slice(7), line, 'badTime', true) };
  }
  const [hours, minutes] = token.split(':').map(Number);
  if (hours > 23 || minutes > 59) throw new RoutineError('badTime', line);
  return { base: 'clock', minutes: hours * 60 + minutes };
}

/** Validate every date of 2026; validate:false rereads previously validated text. */
export function parseRoutine(text, place = DEFAULT_PLACE, { validate = true } = {}) {
  const lines = String(text).split(/\r?\n/);
  if (lines.length > MAX_LINES * 2) throw new RoutineError('tooLong');
  const items = [];
  const keys = new Set();
  lines.forEach((raw, index) => {
    const line = index + 1;
    const source = raw.trim();
    if (!source || source.startsWith('#')) return;
    const split = source.search(/\s/);
    const key = split < 0 ? source : source.slice(0, split);
    const match = key.match(WHEN);
    if (!match) throw new RoutineError('unreadable', line);
    const start = time(match[1], line);
    const end = match[3] ? time(match[3], line) : null;
    let name = split < 0 ? '' : source.slice(split).trim();
    let instructions = '';
    const marker = name.lastIndexOf(' ! ');
    const keepout = marker >= 0 || name.endsWith(' !') || name === '!' || name.startsWith('! ');
    if (name.endsWith(' !')) name = name.slice(0, -1).trim();
    else if (marker >= 0) {
      instructions = name.slice(marker + 3).trim();
      name = name.slice(0, marker).trim();
    } else if (name.startsWith('! ')) {
      instructions = name.slice(2).trim();
      name = '';
    } else if (keepout) name = name.slice(0, -1).trim();
    if (!name) throw new RoutineError('noName', line);
    if ([...name].length > MAX_NAME) throw new RoutineError('nameTooLong', line);
    const until = [];
    let awayMinutes = null;
    let minMinutes = 0;
    if (instructions) {
      const clause = instructions.match(/^(?:until (.+?))?(?:;\s*min (\S+))?$/);
      if (!clause || (!clause[1] && !clause[2])) throw new RoutineError('badUntil', line);
      if (clause[1]) clause[1].split(',').forEach((rawCondition) => {
        const condition = rawCondition.trim();
        if (['done', 'wake', 'photo'].includes(condition)) until.push(condition);
        else if (condition.startsWith('away ')) {
          awayMinutes = duration(condition.slice(5), line, 'badUntil');
          until.push('away');
        } else throw new RoutineError('badUntil', line);
      });
      if (clause[2]) minMinutes = duration(clause[2], line, 'badUntil');
    }
    const kind = match[2] === '..' ? 'window' : 'fixed';
    if (kind === 'window' && keepout && !until.length) throw new RoutineError('badUntil', line);
    if (keys.has(key)) throw new RoutineError('duplicate', line);
    keys.add(key);
    const item = { key, name, kind, start, end, keepout, until, awayMinutes, minMinutes };
    linesByItem.set(item, line);
    items.push(item);
  });
  if (items.length > MAX_LINES) throw new RoutineError('tooLong');
  if (!items.length) throw new RoutineError('empty');
  if (validate) {
    for (let date = '2026-01-01'; date < '2027-01-01'; date = addDate(date, 1)) {
      placeRoutine(items, date, place);
    }
  }
  return items;
}

function resolve(time, date, place, line) {
  try {
    const minutes = time.minutes + (time.base === 'sunset' ? sunsetMinutes(date, place) : 0);
    return localTime(date, minutes, place.tz);
  } catch (error) {
    if (error instanceof RoutineError) throw new RoutineError(error.code, line);
    throw error;
  }
}

/** Place local clock times; dates outside the validated year can throw RoutineError. */
export function placeRoutine(items, date, place = DEFAULT_PLACE) {
  if (!items.length) throw new RoutineError('empty');
  const anchor = zonedMidnight(date, place.tz);
  let itemDate = date;
  const placedStarts = [];
  const placed = items.map((item, index) => {
    const line = linesByItem.get(item) || index + 1;
    let start = resolve(item.start, itemDate, place, line);
    if (index && start < placedStarts[index - 1]) {
      const previous = parts(placedStarts[index - 1], place.tz);
      const incoming = parts(start, place.tz);
      if (Number(previous.hour) < 12 || Number(incoming.hour) >= 12) throw new RoutineError('backwards', line);
      itemDate = addDate(itemDate, 1);
      start = resolve(item.start, itemDate, place, line);
    }
    let end = item.end ? resolve(item.end, itemDate, place, line) : null;
    if (end !== null && end <= start) end = resolve(item.end, addDate(itemDate, 1), place, line);
    placedStarts.push(start);
    return { ...item, start, end };
  });
  placed.forEach((item, index) => {
    if (item.end === null) item.end = placed[index + 1]?.start ?? item.start + 60 * MINUTE;
    if (index && item.start < placed[index - 1].end) {
      throw new RoutineError('overlap', linesByItem.get(items[index]) || index + 1);
    }
  });
  const ends = resolve(items[0].start, addDate(date, 1), place, linesByItem.get(items[0]) || 1);
  return { day: date, anchor, ends, items: placed };
}

/** Pick the instance between this day's first start and the next day's first start. */
export function routineDay(items, now, place = DEFAULT_PLACE) {
  let date = zonedDate(now, place.tz);
  let day = placeRoutine(items, date, place);
  while (now < day.items[0].start) day = placeRoutine(items, date = addDate(date, -1), place);
  while (now >= day.ends) day = placeRoutine(items, date = addDate(date, 1), place);
  return day;
}

function clock(minutes) {
  const normalized = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

/**
 * Ordinary schedule text uses elapsed minutes from the midnight anchor.
 * schedule.js cannot encode every DST-crossing or multi-day elapsed range;
 * round-tripping those can lose a day offset. Seoul routines have no DST.
 */
export function routineSchedule(day) {
  const text = day.items.map((item) => {
    const start = Math.round((item.start - day.anchor) / MINUTE);
    const end = Math.round((item.end - day.anchor) / MINUTE);
    return `${clock(start)}-${clock(end)} ${item.name}`;
  }).join('\n');
  return { text, anchor: day.anchor };
}

function progress(day, item, status, now) {
  const startedAt = Number.isFinite(status?.startedAt) ? Math.max(item.start, status.startedAt) : null;
  const since = item.kind === 'window' ? Math.min(startedAt ?? item.end, item.end) : item.start;
  const doneAfter = since + item.minMinutes * MINUTE;
  const doneAt = status?.doneAt;
  const done = Number.isFinite(doneAt) && doneAt >= doneAfter && doneAt < day.ends && doneAt <= now;
  return { since, doneAfter, done, startedAt };
}

/** Current keepout; proof-bearing locks expire at the next instance's start. */
export function keepoutState(day, statuses, now) {
  if (now >= day.ends) return null;
  let state = null;
  for (const item of day.items) {
    if (!item.keepout || now < item.start) continue;
    const p = progress(day, item, statuses?.[item.key], now);
    const proof = item.until.length > 0;
    const locked = proof ? now >= p.since && !p.done : now < item.end;
    if (!locked || (state && state.since <= p.since)) continue;
    state = {
      key: item.key, name: item.name, kind: item.kind, since: p.since,
      until: proof ? null : item.end, needs: [...item.until],
      canStart: item.kind === 'window' && p.startedAt === null && now < item.end,
      // Temporary: done satisfies every condition until proofs and bypasses land.
      canDone: proof && now >= p.doneAfter,
      doneAfter: p.doneAfter,
    };
  }
  return state;
}

/** Listing phase, including unmet proof items in an expired day instance. */
export function itemPhase(day, item, status, now) {
  if (item.keepout && item.until.length) {
    const p = progress(day, item, status, now);
    if (p.done) return 'done';
    if (now >= day.ends) return 'missed';
    if (now >= item.start && now >= p.since) return 'locked';
  }
  if (now < item.start) return 'upcoming';
  if (now >= item.end) return 'past';
  if (item.keepout && item.kind === 'fixed') return 'locked';
  return 'open';
}
