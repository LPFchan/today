// The schedule format, shared by the browser and the Worker.
//
// A schedule is plain text, one item per line:
//
//   09:00-10:30 Deep work        start and end
//   10:30 Email                  start only; ends where the next line starts
//   # a note                     ignored
//
// Times count in minutes from local midnight of the day the schedule was
// started (its "anchor"). A time that goes backwards after noon rolls over to
// the next day, so a night shift can run past midnight.

const TIME_RANGE = /^(\d{1,2}):(\d{2})\s*(?:-|~|–|—|부터)\s*(\d{1,2}):(\d{2})\s+(.+)$/;
const TIME_ONLY = /^(\d{1,2}):(\d{2})\s+(.+)$/;
const DAY = 24 * 60;

export const MAX_LINES = 60;
export const MAX_NAME = 80;

/** A parse failure. `code` is a key into the string table; `line` is 1-based. */
export class ScheduleError extends Error {
  constructor(code, line = 0) {
    super(`${code}${line ? ` (line ${line})` : ''}`);
    this.code = code;
    this.line = line;
  }
}

function toMinutes(hours, minutes, line) {
  const hour = Number(hours);
  const minute = Number(minutes);
  if (hour > 23 || minute > 59) throw new ScheduleError('badTime', line);
  return hour * 60 + minute;
}

/** Parse schedule text into [{ start, end, name }] in minutes from the anchor. */
export function parseSchedule(text) {
  const lines = String(text).split(/\r?\n/);
  if (lines.length > MAX_LINES * 2) throw new ScheduleError('tooLong');
  const items = [];

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    const lineNumber = index + 1;
    if (!line || line.startsWith('#')) return;

    let match = line.match(TIME_RANGE);
    if (match) {
      const start = toMinutes(match[1], match[2], lineNumber);
      let end = toMinutes(match[3], match[4], lineNumber);
      if (end <= start) end += DAY;
      items.push({ start, end, name: match[5].trim(), line: lineNumber });
      return;
    }

    match = line.match(TIME_ONLY);
    if (match) {
      const start = toMinutes(match[1], match[2], lineNumber);
      items.push({ start, end: null, name: match[3].trim(), line: lineNumber });
      return;
    }

    throw new ScheduleError('unreadable', lineNumber);
  });

  if (items.length > MAX_LINES) throw new ScheduleError('tooLong');

  let dayOffset = 0;
  items.forEach((item, index) => {
    const rawStart = item.start;
    if (index > 0 && rawStart + dayOffset < items[index - 1].start) {
      const previousClock = items[index - 1].start % DAY;
      if (previousClock < 12 * 60 || rawStart >= 12 * 60) {
        throw new ScheduleError('backwards', item.line);
      }
      dayOffset += DAY;
    }

    item.start = rawStart + dayOffset;
    if (item.end !== null) item.end += dayOffset;
    else {
      const nextRawStart = items[index + 1]?.start;
      if (nextRawStart === undefined) item.end = item.start + 60;
      else item.end = nextRawStart + (nextRawStart < rawStart ? dayOffset + DAY : dayOffset);
    }
    if (!item.name) throw new ScheduleError('noName', item.line);
    if ([...item.name].length > MAX_NAME) throw new ScheduleError('nameTooLong', item.line);
    if (index > 0 && item.start < items[index - 1].end) {
      throw new ScheduleError('overlap', item.line);
    }
  });

  return items.map(({ start, end, name }) => ({ start, end, name }));
}

export function formatClock(totalMinutes) {
  const normalized = ((totalMinutes % DAY) + DAY) % DAY;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Canonical text for parsed items: every line gets an explicit end. */
export function serializeSchedule(items) {
  return items.map((item) => `${formatClock(item.start)}-${formatClock(item.end)} ${item.name}`).join('\n');
}

/** Items with absolute times (epoch ms), given the anchor's local midnight. */
export function absoluteItems(items, anchor) {
  return items.map((item) => ({
    start: anchor + item.start * 60_000,
    end: anchor + item.end * 60_000,
    name: item.name,
  }));
}

/**
 * Where `now` falls in a list of absolute items.
 *   active   — inside items[index]
 *   waiting  — before the first item; items[index] is next
 *   break    — between items; items[index] is next
 *   finished — after the last item
 *   empty    — no items
 */
export function dayState(items, now) {
  const completed = items.filter((item) => now >= item.end).length;
  const active = items.findIndex((item) => now >= item.start && now < item.end);
  if (active >= 0) return { kind: 'active', index: active, completed };
  const next = items.findIndex((item) => now < item.start);
  if (next >= 0) return { kind: completed > 0 ? 'break' : 'waiting', index: next, completed };
  return { kind: items.length ? 'finished' : 'empty', index: -1, completed };
}
