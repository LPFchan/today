import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PLACE, DEFAULT_ROUTINE, MAX_LINES, MAX_NAME, RoutineError,
  parseRoutine, sunsetMinutes, zonedMidnight, zonedDate, placeRoutine,
  routineDay, routineSchedule, keepoutState, itemPhase, remainingNeeds, progress, reportInstance,
} from '../public/routine.js';
import { parseSchedule, absoluteItems, serializeSchedule } from '../public/schedule.js';

const MINUTE = 60_000;
const code = (fn) => {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof RoutineError);
    return [error.code, error.line];
  }
  assert.fail('expected a RoutineError');
};
const ny = { tz: 'America/New_York', lat: 40.7128, lon: -74.006 };
const makeDay = (text, date = '2026-10-05', place = DEFAULT_PLACE) => placeRoutine(parseRoutine(text, place), date, place);
const at = (day, hours, minutes = 0) => day.anchor + (hours * 60 + minutes) * MINUTE;

test('bypass pins one proof item/day, preserves proofs and ignores minimum duration', () => {
  const day = makeDay('12:30..14:00 Meal ! until photo; min 20m\n03:00-12:00 Sleep !');
  const item = day.items[0];
  const timestamp = at(day, 13);
  const status = { proofs: { photo: { at: timestamp, note: 'Real proof' } },
    bypass: { day: day.day, key: item.key, at: timestamp } };
  assert.equal(progress(day, item, status, timestamp).bypassed, true);
  assert.equal(itemPhase(day, item, status, timestamp), 'bypassed');
  assert.equal(status.proofs.photo.note, 'Real proof');
  for (const change of [{ day: '2026-10-04' }, { key: 'other' }, { at: day.ends },
    { at: at(day, 12) }, { at: timestamp + 1 }]) {
    assert.equal(progress(day, item, { ...status, bypass: { ...status.bypass, ...change } }, timestamp).bypassed, false);
  }
  const sleep = day.items[1];
  assert.equal(progress(day, sleep, { bypass: { day: day.day, key: sleep.key, at: sleep.start } }, sleep.start).bypassed, false);
  assert.equal(keepoutState(day, { [item.key]: status }, sleep.start).key, sleep.key);
});

test('report separates late completion, bypass, unknown data and off releases', () => {
  const day = makeDay('12:30..14:00 Meal ! until photo');
  const item = day.items[0];
  const snapshot = { day, statuses: {}, observedAt: at(day, 13), stoppedAt: null, away: false };
  assert.equal(reportInstance(snapshot)[0].outcome, 'missed');
  assert.equal(reportInstance({ ...snapshot, observedAt: at(day, 15) })[0].missedDeadline, null);
  const late = { [item.key]: { proofs: { photo: { at: at(day, 15), note: '' } } } };
  const result = reportInstance({ ...snapshot, statuses: late, observedAt: at(day, 16) })[0];
  assert.equal(result.outcome, 'done');
  assert.equal(result.missedDeadline, true);
  const bypass = { [item.key]: { bypass: { day: day.day, key: item.key, at: at(day, 13) } } };
  assert.equal(reportInstance({ ...snapshot, statuses: bypass })[0].missedDeadline, false);
  const off = reportInstance({ ...snapshot, stoppedAt: at(day, 13) })[0];
  assert.equal(off.outcome, 'released');
  assert.equal(off.missedDeadline, false);
  assert.equal(reportInstance({ ...snapshot, away: true })[0].outcome, 'skipped');
});

test('unlock requirements exclude accepted proofs and preserve Done', () => {
  assert.deepEqual(remainingNeeds({ needs: ['away', 'photo'], have: ['away'] }), ['photo']);
  assert.deepEqual(remainingNeeds({ needs: ['wake', 'done'], have: ['wake', 'done'] }), ['done']);
  assert.deepEqual(remainingNeeds({ needs: ['wake'] }), ['wake']);
  assert.deepEqual(remainingNeeds({ needs: [], have: [] }), []);
});

test('routine forms retain tokens, conditions and names', () => {
  const items = parseRoutine(`# comment
12:00-12:20 wake ! until wake, done
12:30..14:00 meal ! until photo; min 20m
sunset-1h..sunset outing ! until away 1h30m, photo
02:00 washing! yay ! until done
02:30-12:00 sleep !
`);
  assert.deepEqual(items[0], {
    key: '12:00-12:20', name: 'wake', kind: 'fixed',
    start: { base: 'clock', minutes: 720 }, end: { base: 'clock', minutes: 740 },
    keepout: true, until: ['wake', 'done'], awayMinutes: null, minMinutes: 0,
  });
  assert.equal(items[1].kind, 'window');
  assert.equal(items[1].minMinutes, 20);
  assert.deepEqual(items[2].until, ['away', 'photo']);
  assert.equal(items[2].awayMinutes, 90);
  assert.equal(items[3].name, 'washing! yay');
  assert.equal(items[3].end, null);
  assert.deepEqual(items[4].until, []);
  assert.equal(parseRoutine('12:00 wow ! really ! until done')[0].name, 'wow ! really');
  assert.equal(parseRoutine('12:00 wow!')[0].keepout, false);
  assert.equal(parseRoutine('12:00 wow ! really !')[0].name, 'wow ! really');
  assert.equal(parseRoutine('12:00..13:00 non-keepout')[0].keepout, false);
  assert.equal(parseRoutine('12:00-13:00 night ! ; min 20m')[0].minMinutes, 20);
});

test('sunset offsets and range separators are unambiguous', () => {
  for (const [token, minutes] of [['sunset', 0], ['sunset-1h', -60], ['sunset+30m', 30], ['sunset-1h30m', -90]]) {
    assert.deepEqual(parseRoutine(`${token} outing`)[0].start, { base: 'sunset', minutes });
  }
  const item = parseRoutine('sunset-1h-sunset outing')[0];
  assert.equal(item.kind, 'fixed');
  assert.deepEqual(item.start, { base: 'sunset', minutes: -60 });
  assert.deepEqual(item.end, { base: 'sunset', minutes: 0 });
  assert.equal(parseRoutine('sunset-sunset+30m rest')[0].end.minutes, 30);
});

test('sunset offsets accept six hours and reject larger magnitudes on their source line', () => {
  for (const [token, minutes] of [
    ['sunset-6h', -360], ['sunset+6h', 360], ['sunset-360m', -360], ['sunset+360m', 360],
  ]) assert.deepEqual(parseRoutine(`${token} outing`, DEFAULT_PLACE, { validate: false })[0].start,
    { base: 'sunset', minutes });
  for (const token of ['sunset-20h..sunset-19h', 'sunset+10h', 'sunset-6h1m',
    'sunset+361m', '12:00-sunset+6h1m', '12:00..sunset-361m']) {
    for (const validate of [true, false]) {
      assert.deepEqual(code(() => parseRoutine(`# note\n${token} invalid`, DEFAULT_PLACE, { validate })),
        ['badTime', 2], token);
    }
  }
});

test('every parse error has its code and source line', () => {
  const cases = [
    ['# note\nhello', 'unreadable', 2],
    ['24:00 invalid', 'badTime', 1],
    ['12:60 invalid', 'badTime', 1],
    ['12:00 x ! until unknown', 'badUntil', 1],
    ['12:00 x ! until away 0m', 'badUntil', 1],
    ['12:00 x ! until done; min nope', 'badUntil', 1],
    ['12:00 x ! until done,', 'badUntil', 1],
    ['12:00 x ! nonsense', 'badUntil', 1],
    ['12:00..13:00 x !', 'badUntil', 1],
    ['12:00', 'noName', 1],
    ['12:00 ! until done', 'noName', 1],
    [`12:00 ${'x'.repeat(MAX_NAME + 1)}`, 'nameTooLong', 1],
    ['12:00-13:00 a\n12:00-13:00 b', 'duplicate', 2],
    ['10:00 a\n09:00 b', 'backwards', 2],
    ['19:00 a\n18:00 b', 'backwards', 2],
    ['09:00-11:00 a\n10:00 b', 'overlap', 2],
    ['# comments only\n', 'empty', 0],
    ['\n'.repeat(MAX_LINES * 2), 'tooLong', 0],
  ];
  for (const [text, expected, line] of cases) {
    assert.deepEqual(code(() => parseRoutine(text)), [expected, line], text);
  }
  const many = Array.from({ length: MAX_LINES + 1 }, (_, i) => `12:${String(i % 60).padStart(2, '0')}-${String(Math.floor(i / 60) + 13).padStart(2, '0')}:00 x`);
  assert.deepEqual(code(() => parseRoutine(many.join('\n'))), ['tooLong', 0]);
  assert.equal(parseRoutine(`12:00 ${'𐀀'.repeat(MAX_NAME)}`)[0].name.length, MAX_NAME * 2);
});

test('default routine parses and rolls its overnight items into tomorrow', () => {
  const items = parseRoutine(DEFAULT_ROUTINE);
  assert.equal(items.length, 8);
  assert.equal(items[2].name, 'lunch');
  const day = placeRoutine(items, '2026-10-05');
  assert.equal(day.items[5].end, at(day, 26, 30));
  assert.equal(day.items[6].start, at(day, 26, 30));
  assert.equal(day.items[6].end, at(day, 27));
  assert.equal(day.items[7].start, at(day, 27));
  assert.equal(day.items[7].end, at(day, 36));
  assert.equal(day.ends, at(day, 36));
  const tomorrow = placeRoutine(items, '2026-10-06');
  assert.equal(day.ends, tomorrow.items[0].start);
});

test('rereading saved text skips annual placement but retains syntax validation', () => {
  assert.deepEqual(parseRoutine(DEFAULT_ROUTINE, DEFAULT_PLACE, { validate: false }), parseRoutine(DEFAULT_ROUTINE));
  const items = parseRoutine('sunset-1h..sunset outing\n19:00-20:00 work', DEFAULT_PLACE, { validate: false });
  assert.deepEqual(code(() => placeRoutine(items, '2026-06-21')), ['overlap', 2]);
  for (const [text, expected] of [
    ['12:00 x ! until nope', 'badUntil'],
    ['12:00-13:00 x\n12:00-13:00 y', 'duplicate'],
    ['24:00 x', 'badTime'],
  ]) assert.deepEqual(code(() => parseRoutine(text, DEFAULT_PLACE, { validate: false })), [expected, expected === 'duplicate' ? 2 : 1]);
});

test('annual validation catches a summer-only overlap and DST-zone overlap', () => {
  assert.deepEqual(code(() => parseRoutine('sunset-1h..sunset outing\n19:00-20:00 work')), ['overlap', 2]);
  // NYC sunsets fit before 18:00 in January, but pass it after the March switch.
  const items = parseRoutine('sunset-1h..sunset outing\n18:00-20:00 work', ny, { validate: false });
  assert.doesNotThrow(() => placeRoutine(items, '2026-01-01', ny));
  assert.deepEqual(code(() => placeRoutine(items, '2026-03-09', ny)), ['overlap', 2]);
  assert.deepEqual(code(() => parseRoutine('sunset-1h..sunset outing\n18:00-20:00 work', ny)), ['overlap', 2]);
});

test('the last item cannot extend into the next instance, with the source line preserved', () => {
  const text = '# note\n12:00-13:00 First\n03:00-14:00 Sleep';
  assert.deepEqual(code(() => parseRoutine(text)), ['overlap', 3]);
  const items = parseRoutine(text, DEFAULT_PLACE, { validate: false });
  assert.deepEqual(code(() => placeRoutine(items, '2026-10-05')), ['overlap', 3]);
  assert.deepEqual(code(() => parseRoutine('12:00-13:00 First\n03:00-14:00 Sleep')), ['overlap', 2]);
  const exact = makeDay('12:00-13:00 First\n03:00-12:00 Sleep');
  assert.equal(exact.items.at(-1).end, exact.ends);
  assert.doesNotThrow(() => parseRoutine(DEFAULT_ROUTINE));
});

test('NOAA sunset is within three minutes of the Seoul reference values', () => {
  assert.ok(Math.abs(sunsetMinutes('2026-12-05', DEFAULT_PLACE) - (17 * 60 + 13)) <= 3);
  assert.ok(Math.abs(sunsetMinutes('2026-06-27', DEFAULT_PLACE) - (19 * 60 + 57)) <= 3);
  assert.ok(sunsetMinutes('2026-06-27', ny) > 20 * 60);
  assert.deepEqual(code(() => sunsetMinutes('2026-02-30')), ['badTime', 0]);
  assert.deepEqual(code(() => sunsetMinutes('2026-06-21', { ...DEFAULT_PLACE, lat: 89 })), ['badTime', 0]);
});

test('zoned dates and midnight include spring and autumn DST changes', () => {
  assert.equal(zonedMidnight('2026-10-05', DEFAULT_PLACE.tz), Date.parse('2026-10-04T15:00:00Z'));
  assert.equal(zonedDate(Date.parse('2026-10-04T15:00:00Z'), DEFAULT_PLACE.tz), '2026-10-05');
  assert.equal(zonedMidnight('2026-03-08', ny.tz), Date.parse('2026-03-08T05:00:00Z'));
  assert.equal(zonedMidnight('2026-03-09', ny.tz), Date.parse('2026-03-09T04:00:00Z'));
  assert.equal(zonedMidnight('2026-11-01', ny.tz), Date.parse('2026-11-01T04:00:00Z'));
  assert.equal(zonedMidnight('2026-11-02', ny.tz), Date.parse('2026-11-02T05:00:00Z'));
  assert.equal(zonedDate(Date.parse('2026-03-09T03:59:00Z'), ny.tz), '2026-03-08');
  assert.equal(zonedDate(Date.parse('2026-03-09T04:00:00Z'), ny.tz), '2026-03-09');
  const items = parseRoutine('12:00-13:00 lunch', ny);
  const day = placeRoutine(items, '2026-03-07', ny);
  assert.equal(day.ends - day.items[0].start, 23 * 60 * MINUTE);
  assert.equal(placeRoutine(items, '2026-03-08', ny).items[0].start, Date.parse('2026-03-08T16:00:00Z'));
});

test('DST gaps move forward and folds choose the earlier occurrence', () => {
  const items = parseRoutine('02:30 gap', ny);
  assert.equal(placeRoutine(items, '2026-03-08', ny).items[0].start, Date.parse('2026-03-08T07:30:00Z'));
  const fold = parseRoutine('01:30 fold', ny);
  assert.equal(placeRoutine(fold, '2026-11-01', ny).items[0].start, Date.parse('2026-11-01T05:30:00Z'));
});

test('routineDay picks yesterday at 11:00 and switches exactly at the first start', () => {
  const items = parseRoutine(DEFAULT_ROUTINE);
  const day = placeRoutine(items, '2026-10-05');
  assert.equal(routineDay(items, at(day, 11)).day, '2026-10-04');
  assert.equal(routineDay(items, at(day, 12)).day, day.day);
  assert.equal(routineDay(items, day.ends).day, '2026-10-06');
});

test('sunset-first expiry is tomorrow\'s sunset, not today plus 24 hours', () => {
  const items = parseRoutine('sunset-1h..sunset outing ! until done');
  const day = placeRoutine(items, '2026-06-01');
  const tomorrow = placeRoutine(items, '2026-06-02');
  assert.equal(day.ends, tomorrow.items[0].start);
  assert.notEqual(day.ends, day.items[0].start + 24 * 60 * MINUTE);
  assert.equal(routineDay(items, day.ends - 1).day, day.day);
  assert.equal(routineDay(items, day.ends).day, tomorrow.day);
});

test('schedule text round-trips to identical absolute item times', () => {
  for (const [text, date, place] of [
    [DEFAULT_ROUTINE, '2026-10-05', DEFAULT_PLACE],
    ['23:00 work\n01:00-02:00 late', '2026-10-05', DEFAULT_PLACE],
    ['12:00-13:00 lunch\n23:00-00:30 evening', '2026-03-08', ny],
  ]) {
    const day = makeDay(text, date, place);
    const schedule = routineSchedule(day);
    assert.equal(schedule.anchor, day.anchor);
    assert.deepEqual(absoluteItems(parseSchedule(schedule.text), schedule.anchor),
      day.items.map(({ start, end, name }) => ({ start, end, name })));
  }
});

test('default and six-hour sunset offsets round-trip in June and December', () => {
  const offsetRoutine = `09:00-10:00 First
sunset-6h-sunset Early
sunset..sunset+6h Late`;
  for (const text of [DEFAULT_ROUTINE, offsetRoutine]) {
    const items = parseRoutine(text);
    for (const date of ['2026-06-27', '2026-12-05']) {
      const day = placeRoutine(items, date);
      const schedule = routineSchedule(day);
      assert.deepEqual(absoluteItems(parseSchedule(schedule.text), schedule.anchor),
        day.items.map(({ start, end, name }) => ({ start, end, name })), `${date}: ${text}`);
    }
  }
});

test('placement rejects times the ordinary day plan cannot represent at the original source line', () => {
  assert.deepEqual(code(() => parseRoutine('sunset+6h Late')), ['badTime', 1]);
  const text = '# note\n\nsunset+6h Late';
  const items = parseRoutine(text, DEFAULT_PLACE, { validate: false });
  assert.deepEqual(code(() => placeRoutine(items, '2026-06-27')), ['badTime', 3]);
  assert.doesNotThrow(() => placeRoutine(items, '2026-12-05'));
  // The day plan cannot roll past midnight after an early-morning first item.
  const later = '# note\n04:00-05:00 Early\n# note\nsunset+6h Late';
  assert.deepEqual(code(() => parseRoutine(later)), ['badTime', 4]);
  const laterItems = parseRoutine(later, DEFAULT_PLACE, { validate: false });
  assert.deepEqual(code(() => placeRoutine(laterItems, '2026-06-27')), ['badTime', 4]);
  assert.doesNotThrow(() => parseRoutine(DEFAULT_ROUTINE));
});

test('fixed time-only locks ignore completion and stop at their slot end', () => {
  const day = makeDay('12:00-13:00 sleep !');
  const item = day.items[0];
  assert.equal(keepoutState(day, {}, at(day, 11)), null);
  const state = keepoutState(day, { [item.key]: { doneAt: at(day, 12) } }, at(day, 12, 30));
  assert.deepEqual(state, {
    key: item.key, name: 'sleep', kind: 'fixed', since: at(day, 12), until: at(day, 13),
    needs: [], have: [], canStart: false, canDone: false, doneAfter: at(day, 12),
  });
  assert.equal(keepoutState(day, {}, at(day, 13)), null);
  assert.equal(itemPhase(day, item, {}, at(day, 12)), 'locked');
  assert.equal(itemPhase(day, item, {}, day.ends), 'past');
});

test('fixed proof locks outlive the slot but become missed at expiry', () => {
  const day = makeDay('12:00-12:20 wash ! until done');
  const item = day.items[0];
  const now = at(day, 16);
  assert.equal(keepoutState(day, {}, now).until, null);
  assert.equal(keepoutState(day, {}, now).canDone, true);
  assert.equal(itemPhase(day, item, {}, now), 'locked');
  assert.equal(itemPhase(day, item, {}, day.ends), 'missed');
  assert.equal(keepoutState(day, {}, day.ends), null);
  const status = { doneAt: at(day, 15) };
  assert.equal(keepoutState(day, { [item.key]: status }, now), null);
  assert.equal(itemPhase(day, item, status, day.ends), 'done');
  assert.equal(itemPhase(day, item, { doneAt: day.ends }, day.ends), 'missed');
});

test('windows open unlocked, start early or force a lock at the deadline', () => {
  const day = makeDay('12:30..14:00 meal ! until photo; min 20m');
  const item = day.items[0];
  assert.equal(itemPhase(day, item, {}, at(day, 12)), 'upcoming');
  assert.equal(itemPhase(day, item, {}, at(day, 13)), 'open');
  assert.equal(keepoutState(day, {}, at(day, 13)), null);
  const started = { startedAt: at(day, 13) };
  const early = keepoutState(day, { [item.key]: started }, at(day, 13, 10));
  assert.equal(early.since, started.startedAt);
  assert.equal(early.doneAfter, at(day, 13, 20));
  assert.equal(early.canDone, false);
  assert.equal(early.canStart, false);
  assert.equal(itemPhase(day, item, started, at(day, 13, 10)), 'locked');
  const deadline = keepoutState(day, {}, at(day, 14));
  assert.equal(deadline.since, at(day, 14));
  assert.equal(deadline.doneAfter, at(day, 14, 20));
  assert.deepEqual(deadline.needs, ['photo']);
  assert.equal(keepoutState(day, {}, at(day, 14, 20)).canDone, false);
  assert.equal(keepoutState(day, { [item.key]: { startedAt: at(day, 15) } }, at(day, 16)).since, at(day, 14));
  assert.equal(keepoutState(day, {}, day.ends), null);
  assert.equal(itemPhase(day, item, {}, day.ends), 'missed');
});

// Done is no longer accepted for proof items, but a recorded Done still counts.
test('a window finished while open is done and never locks', () => {
  const day = makeDay('12:30..14:00 meal ! until photo');
  const item = day.items[0];
  const status = { [item.key]: { doneAt: at(day, 13) } };
  assert.equal(itemPhase(day, item, status[item.key], at(day, 13, 5)), 'done');
  assert.equal(keepoutState(day, status, at(day, 15)), null);
  assert.equal(itemPhase(day, item, status[item.key], day.ends), 'done');
  // Before it opened doesn't count.
  const tooEarly = { [item.key]: { doneAt: at(day, 12) } };
  assert.ok(keepoutState(day, tooEarly, at(day, 15)));
});

test('minimum lock time rejects premature completion and honors its exact boundary', () => {
  const day = makeDay('12:30..14:00 meal ! until done; min 20m');
  const item = day.items[0];
  const startedAt = at(day, 13);
  const invalid = { startedAt, doneAt: at(day, 13, 19) };
  assert.ok(keepoutState(day, { [item.key]: invalid }, at(day, 15)));
  assert.equal(keepoutState(day, { [item.key]: invalid }, at(day, 13, 20)).canDone, true);
  const valid = { startedAt, doneAt: at(day, 13, 20) };
  assert.equal(keepoutState(day, { [item.key]: valid }, at(day, 13, 20)), null);
  assert.equal(itemPhase(day, item, valid, at(day, 13, 20)), 'done');
  assert.ok(keepoutState(day, { [item.key]: valid }, at(day, 13, 19)));
  const fixed = makeDay('12:00-12:20 wash ! until done; min 30m');
  assert.equal(keepoutState(fixed, {}, at(fixed, 12, 20)).canDone, false);
  assert.equal(keepoutState(fixed, {}, at(fixed, 12, 30)).canDone, true);
});

test('adjacent free blocks never lock and do not clear an overdue window', () => {
  const day = makeDay(DEFAULT_ROUTINE);
  const outing = day.items[4];
  const free = day.items[5];
  assert.equal(outing.end, free.start);
  assert.equal(free.end, day.items[6].start);
  assert.equal(itemPhase(day, free, {}, free.start - 1), 'upcoming');
  assert.equal(itemPhase(day, free, {}, free.start), 'open');
  assert.equal(itemPhase(day, free, {}, free.end), 'past');
  const statuses = {
    [day.items[0].key]: { doneAt: day.items[0].end },
    [day.items[1].key]: { doneAt: day.items[1].end },
    [day.items[2].key]: { doneAt: day.items[2].end },
  };
  assert.equal(keepoutState(day, statuses, free.start + MINUTE).key, outing.key);
  statuses[outing.key] = { doneAt: free.start + MINUTE };
  assert.equal(keepoutState(day, statuses, free.start + MINUTE), null);
  assert.equal(day.items[3].name, free.name);
  assert.notEqual(day.items[3].key, free.key);
});

test('earliest lock wins, ties preserve item order, and no keepout means null', () => {
  const day = makeDay('12:00-12:20 wake ! until wake\n12:30..14:00 meal ! until photo');
  assert.equal(keepoutState(day, {}, at(day, 16)).key, day.items[0].key);
  assert.equal(keepoutState(day, { [day.items[0].key]: { doneAt: at(day, 13) } }, at(day, 16)).key, day.items[1].key);
  const tied = { ...day, items: [day.items[0], { ...day.items[0], key: 'second' }] };
  assert.equal(keepoutState(tied, {}, at(day, 16)).key, day.items[0].key);
  const free = makeDay('12:00..13:00 free');
  assert.equal(keepoutState(free, {}, at(free, 12, 30)), null);
  assert.equal(itemPhase(free, free.items[0], {}, at(free, 13)), 'past');
});


test('same-start points remain consecutive moments and lock in listed order until the next instance', () => {
  const day = makeDay('12:00 Wake ! until wake\n12:00 Wash ! until done\n12:00 Teeth ! until done\n12:30-13:00 Lunch');
  assert.equal(routineSchedule(day).text, '12:00 Wake\n12:00 Wash\n12:00 Teeth\n12:30-13:00 Lunch');
  assert.deepEqual(day.items.map(({ key }) => key), ['12:00', '12:00#2', '12:00#3', '12:30-13:00']);
  const now = at(day, 16);
  const statuses = {};
  for (const item of day.items.slice(0, 3)) {
    assert.equal(itemPhase(day, item, statuses[item.key], now), 'locked');
    assert.equal(keepoutState(day, statuses, now).key, item.key);
    statuses[item.key] = { doneAt: now };
    assert.equal(itemPhase(day, item, statuses[item.key], now), 'done');
  }
  assert.equal(keepoutState(day, statuses, now), null);
  assert.equal(keepoutState(day, {}, day.ends), null);
  assert.equal(itemPhase(day, day.items[0], {}, day.ends), 'missed');
});

test('default routine places and its moment-containing plan round-trips every day of the year', () => {
  const items = parseRoutine(DEFAULT_ROUTINE);
  assert.deepEqual(items.slice(0, 3).map(({ name, until }) => ({ name, until })), [
    { name: 'wake up', until: ['wake'] },
    { name: 'wash face, brush teeth', until: ['done'] },
    { name: 'lunch', until: ['photo'] },
  ]);
  for (let epoch = Date.parse('2026-01-01'); epoch < Date.parse('2027-01-01'); epoch += 24 * 60 * MINUTE) {
    const day = placeRoutine(items, new Date(epoch).toISOString().slice(0, 10));
    const plan = routineSchedule(day);
    const restored = absoluteItems(parseSchedule(plan.text), plan.anchor);
    assert.equal(restored.length, items.length);
    assert.equal(restored[0].start, restored[0].end);
    assert.deepEqual(restored, day.items.map(({ start, end, name }) => ({ start, end, name })));
    assert.deepEqual(parseSchedule(serializeSchedule(parseSchedule(plan.text))), parseSchedule(plan.text));
  }
});
