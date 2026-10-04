import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { DEFAULT_ROUTINE, parseRoutine, routineDay, routineSchedule } from '../public/routine.js';
import { testDatabase } from './d1.js';

const ORIGIN = 'https://today.lost.plus';
const ROUTINE = `12:00-12:20 Wake ! until wake, done
12:30..14:00 Meal ! until photo; min 20m
14:00-02:30 Free
02:30-12:00 Sleep !`;
const instant = (time, day = '2026-10-05') => Date.parse(`${day}T${time}:00+09:00`);

// Headers exactly as the gateway injects them.
function as(sub, name = sub) {
  return {
    'x-lost-plus-encoding': 'percent-utf8',
    'x-lost-plus-sub': encodeURIComponent(sub),
    'x-lost-plus-email': encodeURIComponent(`${sub}@example.com`),
    'x-lost-plus-name': encodeURIComponent(name),
    'x-lost-plus-role': 'user',
  };
}

function setup(t, time = '12:30') {
  let now = instant(time);
  t.mock.method(Date, 'now', () => now);
  const DB = testDatabase();
  t.after(() => DB.raw.close());
  const call = async (method, path, body, sub = 'owner') => {
    const headers = sub === null ? {} : as(sub);
    const init = { method, headers };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      headers['content-type'] = 'application/json';
    }
    const response = await worker.fetch(new Request(ORIGIN + path, init), { DB });
    return { status: response.status, body: await response.json() };
  };
  return {
    DB, call,
    at: (time, day) => { now = instant(time, day); },
    enable: (text = ROUTINE) => call('PUT', '/api/routine', { text, enabled: true }),
    status: (action, key, day = '2026-10-05') => call('POST', `/api/routine/${action}`, { day, key }),
  };
}

function expectedSchedule(text, time, date = '2026-10-05') {
  return routineSchedule(routineDay(parseRoutine(text), instant(time, date)));
}

function expectError(response, status, error) {
  assert.deepEqual(response, { status, body: { error } });
}

test('routine routes require gateway identity and reject malformed writes', async (t) => {
  const { call, DB } = setup(t);
  for (const [method, path] of [
    ['GET', '/api/routine'], ['PUT', '/api/routine'],
    ['POST', '/api/routine/start'], ['POST', '/api/routine/done'], ['GET', '/api/keepout'],
  ]) expectError(await call(method, path, undefined, null), 401, 'unauthenticated');
  for (const body of [null, [], {}, { text: 3 }, { enabled: 1 }, { text: ROUTINE, enabled: null }]) {
    expectError(await call('PUT', '/api/routine', body), 400, 'bad_request');
  }
  for (const action of ['start', 'done']) {
    for (const body of [null, {}, { day: 5, key: 'meal' }]) {
      expectError(await call('POST', `/api/routine/${action}`, body), 400, 'bad_request');
    }
  }
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routines').get().n, 0);
});

test('opted-out users retain their profile, board and watch; routine reads write nothing', async (t) => {
  const { call, DB } = setup(t);
  assert.deepEqual((await call('GET', '/api/routine')).body, {
    enabled: false, text: DEFAULT_ROUTINE, pendingFrom: null, tz: 'Asia/Seoul', today: null,
  });
  assert.deepEqual((await call('GET', '/api/keepout')).body, { now: Date.now(), keepout: null });
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM people').get().n, 0);
  const initial = await call('GET', '/api/me');
  assert.deepEqual(initial.body, {
    me: { sub: 'owner', name: 'owner', email: 'owner@example.com' }, visibility: 'private', schedule: null,
  });
  await call('PUT', '/api/schedule', { text: '12:00-13:00 Work', anchor: instant('00:00') });
  const before = DB.raw.prepare('SELECT * FROM people').all();
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, {
    text: '12:00-13:00 Work', anchor: instant('00:00'),
  });
  assert.deepEqual((await call('GET', '/api/watch')).body, {
    now: Date.now() / 1000, items: [[instant('12:00') / 1000, instant('13:00') / 1000, 'Work']],
  });
  assert.deepEqual((await call('GET', '/api/board')).body, {
    now: Date.now(), people: [{ name: 'owner', me: true, visibility: 'private',
      items: [{ start: instant('12:00'), end: instant('13:00'), name: 'Work' }] }],
  });
  await call('GET', '/api/routine');
  await call('GET', '/api/keepout');
  assert.deepEqual(DB.raw.prepare('SELECT * FROM people').all(), before);
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routines').get().n, 0);
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_status').get().n, 0);
  await call('PUT', '/api/routine', { text: ROUTINE });
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, {
    text: '12:00-13:00 Work', anchor: instant('00:00'),
  });
  assert.equal((await call('GET', '/api/routine')).body.today, null);
});

test('enabling materializes the routine into the profile, watch and public board', async (t) => {
  const { enable, call, DB } = setup(t);
  const enabled = await enable();
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.enabled, true);
  assert.equal(enabled.body.today.day, '2026-10-05');
  assert.ok(enabled.body.today.items.every((item) => item.startedAt === null && item.doneAt === null));
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, expectedSchedule(ROUTINE, '12:30'));
  const items = enabled.body.today.items;
  assert.deepEqual((await call('GET', '/api/watch')).body.items,
    items.map(({ start, end, name }) => [start / 1000, end / 1000, name]));
  await call('PUT', '/api/visibility', { visibility: 'public' });
  const board = (await call('GET', '/api/board', undefined, 'viewer')).body;
  assert.deepEqual(board.people, [{ name: 'owner', me: false, visibility: 'public',
    items: items.map(({ start, end, name }) => ({ start, end, name })) }]);
  assert.equal(JSON.stringify(board).includes('keepout'), false);
  assert.equal(DB.raw.prepare('SELECT materialized_day FROM routines').get().materialized_day, '2026-10-05');
});

test('a visibility write paused across rollover cannot restore a stale schedule', async (t) => {
  const { enable, call, at, DB } = setup(t);
  await enable();
  const stale = DB.raw.prepare('SELECT schedule, anchor FROM people WHERE sub = ?').get('owner');
  const prepare = DB.prepare.bind(DB);
  let pause;
  let resume;
  const paused = new Promise((resolve) => { pause = resolve; });
  const resumed = new Promise((resolve) => { resume = resolve; });
  t.mock.method(DB, 'prepare', (sql) => {
    const statement = prepare(sql);
    if (!sql.startsWith('INSERT INTO people')) return statement;
    return {
      ...statement,
      bind: (...values) => {
        const bound = statement.bind(...values);
        return {
          ...bound,
          run: async () => {
            if (values[2] === 'public') {
              pause();
              await resumed;
            }
            return bound.run();
          },
        };
      },
    };
  });
  at('12:00', '2026-10-06');
  const visibility = call('PUT', '/api/visibility', { visibility: 'public' });
  await paused;
  const expected = expectedSchedule(ROUTINE, '12:00', '2026-10-06');
  try {
    assert.deepEqual((await call('GET', '/api/me')).body.schedule, expected);
    assert.notEqual(stale.anchor, expected.anchor);
  } finally {
    resume();
  }
  const saved = await visibility;
  assert.equal(saved.status, 200);
  assert.equal(saved.body.visibility, 'public');
  assert.deepEqual(saved.body.schedule, expected);
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, expected);
  assert.equal(DB.raw.prepare('SELECT materialized_day FROM routines').get().materialized_day, '2026-10-06');
});

test('concurrent rollover reads claim the day once and preserve a manual save between them', async (t) => {
  const { enable, call, at, DB } = setup(t);
  await enable();
  const prepare = DB.prepare.bind(DB);
  let pause;
  let resume;
  let holdSnapshot = true;
  let prunes = 0;
  const claims = [];
  const paused = new Promise((resolve) => { pause = resolve; });
  const resumed = new Promise((resolve) => { resume = resolve; });
  t.mock.method(DB, 'prepare', (sql) => {
    const statement = prepare(sql);
    return {
      ...statement,
      bind: (...values) => {
        const bound = statement.bind(...values);
        return {
          ...bound,
          first: async () => {
            const snapshot = await bound.first();
            if (sql === 'SELECT * FROM routines WHERE sub = ?1' && holdSnapshot) {
              holdSnapshot = false;
              assert.equal(snapshot.materialized_day, '2026-10-05');
              pause();
              await resumed;
            }
            return snapshot;
          },
          run: async () => {
            const written = await bound.run();
            if (sql.includes('materialized_day IS NOT')) claims.push(written.meta.changes);
            if (sql.startsWith('DELETE FROM routine_status') && sql.includes('day <')) prunes++;
            return written;
          },
        };
      },
    };
  });
  at('12:00', '2026-10-06');
  const delayed = call('GET', '/api/me');
  await paused;
  const manual = { text: '13:00-14:00 Manual', anchor: instant('00:00', '2026-10-06') };
  try {
    assert.deepEqual((await call('GET', '/api/me')).body.schedule, expectedSchedule(ROUTINE, '12:00', '2026-10-06'));
    assert.deepEqual((await call('PUT', '/api/schedule', manual)).body.schedule, manual);
  } finally {
    resume();
  }
  const finished = await delayed;
  assert.equal(finished.status, 200);
  assert.deepEqual(finished.body.schedule, manual);
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, manual);
  assert.deepEqual(claims, [1, 0]);
  assert.equal(prunes, 1);
  assert.equal(DB.raw.prepare('SELECT materialized_day FROM routines').get().materialized_day, '2026-10-06');
});

test('manual edits survive until the instance changes at its first start', async (t) => {
  const { enable, call, at } = setup(t);
  await enable();
  const manual = { text: '13:00-14:00 Manual', anchor: instant('00:00') };
  await call('PUT', '/api/schedule', manual);
  assert.equal((await call('PUT', '/api/routine', { text: ROUTINE, enabled: true })).status, 200);
  await call('GET', '/api/routine');
  await call('GET', '/api/keepout');
  await call('GET', '/api/board');
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, manual);
  at('11:59', '2026-10-06');
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, manual);
  at('12:00', '2026-10-06');
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, expectedSchedule(ROUTINE, '12:00', '2026-10-06'));
});

test('enabled edits wait for the next instance and leave the current plan and keepout unchanged', async (t) => {
  const { enable, call, at, DB } = setup(t, '12:00');
  await enable();
  at('13:00');
  const before = (await call('GET', '/api/routine')).body.today;
  const revised = ROUTINE.replace('Wake ! until wake, done', 'New wake')
    .replace('14:00-02:30 Free', '14:00-02:30 New plan');
  const saved = await call('PUT', '/api/routine', { text: revised });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.text, revised);
  assert.equal(saved.body.pendingFrom, '2026-10-06');
  assert.deepEqual(saved.body.today, before);
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, expectedSchedule(ROUTINE, '13:00'));
  assert.equal(DB.raw.prepare('SELECT text FROM routines').get().text, ROUTINE);
  at('11:59', '2026-10-06');
  assert.equal((await call('GET', '/api/routine')).body.pendingFrom, '2026-10-06');
  at('12:00', '2026-10-06');
  const next = (await call('GET', '/api/routine')).body;
  assert.equal(next.text, revised);
  assert.equal(next.pendingFrom, null);
  assert.equal(next.today.day, '2026-10-06');
  assert.equal(next.today.items[0].name, 'New wake');
  assert.equal(next.today.keepout, null);
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, expectedSchedule(revised, '12:00', '2026-10-06'));
  assert.deepEqual({ ...DB.raw.prepare('SELECT text, pending_text, pending_from FROM routines').get() }, {
    text: revised, pending_text: null, pending_from: null,
  });
});

test('enabling after an operator switch-off replaces a same-day manual plan', async (t) => {
  const { enable, call, status, at, DB } = setup(t, '12:00');
  await enable();
  await status('done', '12:00-12:20');
  at('12:30');
  const manual = { text: '13:00-14:00 Manual', anchor: instant('00:00') };
  await call('PUT', '/api/schedule', manual);
  expectError(await call('PUT', '/api/routine', { enabled: false }), 409, 'ask_hermes');
  DB.raw.prepare('UPDATE routines SET enabled = 0 WHERE sub = ?').run('owner');
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, manual);
  assert.equal((await call('PUT', '/api/routine', { enabled: true })).status, 200);
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, expectedSchedule(ROUTINE, '12:30'));
});

test('text edits while off apply immediately without writing a day plan', async (t) => {
  const { call, DB } = setup(t);
  const revised = ROUTINE.replace('Free', 'Edited free time');
  for (const text of [ROUTINE, revised]) {
    const saved = await call('PUT', '/api/routine', { text });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body, {
      enabled: false, text, pendingFrom: null, tz: 'Asia/Seoul', today: null,
    });
    const row = DB.raw.prepare('SELECT * FROM routines').get();
    assert.equal(row.text, text);
    assert.equal(row.pending_text, null);
    assert.equal(row.pending_from, null);
  }
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM people').get().n, 0);
  assert.equal((await call('PUT', '/api/routine', { enabled: true })).status, 200);
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, expectedSchedule(revised, '12:30'));
});

test('an immediate text change clears this owner’s progress before same-day re-enabling', async (t) => {
  const { enable, call, status, at, DB } = setup(t);
  await enable();
  assert.equal((await status('start', '12:30..14:00')).status, 200);
  at('12:50');
  const completed = await status('done', '12:30..14:00');
  assert.equal(completed.body.today.items.find((item) => item.key === '12:30..14:00').phase, 'done');
  const originalStatus = DB.raw.prepare('SELECT * FROM routine_status WHERE sub = ?').all('owner');
  assert.equal((await call('PUT', '/api/routine', { text: ROUTINE.replace('Meal', 'Pending meal') })).status, 200);
  assert.deepEqual(DB.raw.prepare('SELECT * FROM routine_status WHERE sub = ?').all('owner'), originalStatus);
  DB.raw.prepare('UPDATE routines SET enabled = 0 WHERE sub = ?').run('owner');
  assert.equal((await call('PUT', '/api/routine', { text: ROUTINE })).status, 200);
  assert.deepEqual(DB.raw.prepare('SELECT * FROM routine_status WHERE sub = ?').all('owner'), originalStatus);
  assert.equal((await call('PUT', '/api/routine', { text: 'invalid' })).status, 422);
  assert.deepEqual(DB.raw.prepare('SELECT * FROM routine_status WHERE sub = ?').all('owner'), originalStatus);
  DB.raw.prepare('INSERT INTO routine_status (sub, day, key, done_at) VALUES (?, ?, ?, ?)')
    .run('owner', '2026-10-04', '12:30..14:00', instant('12:50', '2026-10-04'));
  DB.raw.prepare('INSERT INTO routine_status (sub, day, key, done_at) VALUES (?, ?, ?, ?)')
    .run('other', '2026-10-05', '12:30..14:00', instant('12:50'));
  const revised = ROUTINE.replace('Meal', 'Different meal');
  assert.equal((await call('PUT', '/api/routine', { text: revised })).status, 200);
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_status WHERE sub = ?').get('owner').n, 0);
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_status WHERE sub = ?').get('other').n, 1);
  const reenabled = await call('PUT', '/api/routine', { enabled: true });
  assert.equal(reenabled.status, 200);
  const meal = reenabled.body.today.items.find((item) => item.key === '12:30..14:00');
  assert.equal(meal.name, 'Different meal');
  assert.equal(meal.startedAt, null);
  assert.equal(meal.doneAt, null);
  assert.equal(meal.phase, 'open');
  assert.equal((await status('start', meal.key)).body.today.keepout.key, meal.key);
});

test('a second edit replaces pending text; enabling and invalid edits leave it alone', async (t) => {
  const { enable, call, at, DB } = setup(t);
  await enable();
  const first = ROUTINE.replace('Free', 'First edit');
  const second = ROUTINE.replace('Free', 'Second edit');
  assert.equal((await call('PUT', '/api/routine', { text: first })).status, 200);
  at('13:00');
  const saved = await call('PUT', '/api/routine', { text: second });
  assert.equal(saved.body.text, second);
  assert.equal(saved.body.pendingFrom, '2026-10-06');
  assert.equal((await call('PUT', '/api/routine', { enabled: true })).body.text, second);
  assert.deepEqual(await call('PUT', '/api/routine', { text: 'not a routine' }), {
    status: 422, body: { error: 'unreadable', line: 1 },
  });
  assert.equal((await call('GET', '/api/routine')).body.text, second);
  assert.equal(DB.raw.prepare('SELECT text FROM routines').get().text, ROUTINE);
  const manual = { text: '13:00-14:00 Manual', anchor: instant('00:00') };
  await call('PUT', '/api/schedule', manual);
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, manual);
  at('12:00', '2026-10-07');
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, expectedSchedule(second, '12:00', '2026-10-07'));
  assert.equal((await call('GET', '/api/routine')).body.pendingFrom, null);
});

test('overnight edits target the next instance date, not the next calendar date', async (t) => {
  const { enable, call, at } = setup(t, '02:10');
  await enable();
  const revised = ROUTINE.replace('Free', 'Next instance');
  const saved = await call('PUT', '/api/routine', { text: revised });
  assert.equal(saved.body.today.day, '2026-10-04');
  assert.equal(saved.body.pendingFrom, '2026-10-05');
  at('12:00');
  const next = (await call('GET', '/api/routine')).body;
  assert.equal(next.pendingFrom, null);
  assert.equal(next.today.items.find((item) => item.key === '14:00-02:30').name, 'Next instance');
});

test('moving the first start later waits for the pending routine to begin its next instance', async (t) => {
  const { enable, call, at } = setup(t, '12:00');
  const original = '12:00-12:30 First ! until done\n14:00-15:00 Second ! until done';
  const revised = original.replace('12:00-12:30', '13:00-13:30');
  await enable(original);
  assert.equal((await call('PUT', '/api/routine', { text: revised })).body.pendingFrom, '2026-10-06');
  at('12:00', '2026-10-06');
  const waiting = (await call('GET', '/api/routine')).body;
  assert.equal(waiting.pendingFrom, '2026-10-06');
  assert.equal(waiting.today.items[0].key, '12:00-12:30');
  at('13:00', '2026-10-06');
  for (let read = 0; read < 2; read++) {
    const next = (await call('GET', '/api/routine')).body;
    assert.equal(next.today.day, '2026-10-06');
    assert.equal(next.pendingFrom, null);
    assert.equal(next.today.items[0].start, instant('13:00', '2026-10-06'));
    assert.equal(next.today.items[0].phase, 'locked');
  }
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, {
    text: revised.replaceAll(' ! until done', ''), anchor: instant('00:00', '2026-10-06'),
  });
  at('13:00', '2026-10-06');
  assert.equal((await call('GET', '/api/keepout')).body.keepout.key, '13:00-13:30');
});

test('an earlier pending first start promotes without waiting for the old first start', async (t) => {
  const { enable, call, at, DB } = setup(t, '13:00');
  const original = '13:00-13:30 First ! until done\n14:00-15:00 Second ! until done';
  const revised = original.replace('13:00-13:30', '12:00-12:30');
  await enable(original);
  assert.equal((await call('PUT', '/api/routine', { text: revised })).body.pendingFrom, '2026-10-06');
  at('11:59', '2026-10-06');
  assert.equal((await call('GET', '/api/routine')).body.pendingFrom, '2026-10-06');
  at('12:00', '2026-10-06');
  const next = (await call('GET', '/api/routine')).body;
  assert.equal(next.pendingFrom, null);
  assert.equal(next.today.day, '2026-10-06');
  assert.equal(next.today.keepout.key, '12:00-12:30');
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, expectedSchedule(revised, '12:00', '2026-10-06'));
  assert.equal(DB.raw.prepare('SELECT text FROM routines').get().text, revised);
});

test('unplaceable pending text leaves the active routine and pending edit intact', async (t) => {
  const { enable, call, at, DB } = setup(t);
  await enable();
  const pending = '12:00-13:00 First\n03:00-14:00 Sleep';
  DB.raw.prepare('UPDATE routines SET pending_text = ?, pending_from = ? WHERE sub = ?')
    .run(pending, '2026-10-06', 'owner');
  at('12:00', '2026-10-06');
  const result = await call('GET', '/api/routine');
  assert.equal(result.status, 200);
  assert.equal(result.body.text, pending);
  assert.equal(result.body.pendingFrom, '2026-10-06');
  assert.equal(result.body.today.day, '2026-10-06');
  assert.equal(result.body.today.keepout.key, '12:00-12:20');
  assert.equal(DB.raw.prepare('SELECT text FROM routines').get().text, ROUTINE);
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, expectedSchedule(ROUTINE, '12:00', '2026-10-06'));
});

for (const route of ['/api/me', '/api/watch', '/api/routine', '/api/keepout', '/api/board']) {
  test(`${route} promotes pending text and materializes a new instance`, async (t) => {
    const { enable, call, at, DB } = setup(t);
    await enable();
    await call('PUT', '/api/visibility', { visibility: 'public' });
    const revised = ROUTINE.replace('Free', 'Pending plan');
    assert.equal((await call('PUT', '/api/routine', { text: revised })).body.pendingFrom, '2026-10-06');
    at('12:00', '2026-10-06');
    await call('GET', route, undefined, route === '/api/board' ? 'viewer' : 'owner');
    const person = DB.raw.prepare('SELECT schedule, anchor FROM people WHERE sub = ?').get('owner');
    const expected = expectedSchedule(revised, '12:00', '2026-10-06');
    assert.deepEqual({ text: person.schedule, anchor: person.anchor }, expected);
    assert.equal(DB.raw.prepare('SELECT materialized_day FROM routines').get().materialized_day, '2026-10-06');
    assert.deepEqual({ ...DB.raw.prepare('SELECT text, pending_text, pending_from FROM routines').get() }, {
      text: revised, pending_text: null, pending_from: null,
    });
  });
}

test('saving validates all seasons and includes the failing source line', async (t) => {
  const { call, DB } = setup(t);
  assert.deepEqual(await call('PUT', '/api/routine', { text: '12:00 A\nnot a time' }), {
    status: 422, body: { error: 'unreadable', line: 2 },
  });
  assert.deepEqual(await call('PUT', '/api/routine', { text: '12:00-sunset A\n19:00-20:00 B' }), {
    status: 422, body: { error: 'overlap', line: 2 },
  });
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routines').get().n, 0);
  const defaultEnabled = await call('PUT', '/api/routine', { enabled: true });
  assert.equal(defaultEnabled.status, 200);
  assert.equal(defaultEnabled.body.text, DEFAULT_ROUTINE);
});

test('switching off requires Hermes both during a lock and outside it; edits and enabling stay allowed', async (t) => {
  const { enable, call, status, at } = setup(t, '12:00');
  await call('PUT', '/api/routine', { text: ROUTINE });
  assert.equal((await call('PUT', '/api/routine', { enabled: true })).status, 200);
  assert.equal((await call('PUT', '/api/routine', { text: ROUTINE + '\n# edit' })).status, 200);
  expectError(await call('PUT', '/api/routine', { enabled: false }), 409, 'ask_hermes');
  assert.equal((await call('PUT', '/api/routine', { enabled: true })).status, 200);
  assert.equal((await enable()).status, 200);
  await status('done', '12:00-12:20');
  at('12:30');
  assert.equal((await call('GET', '/api/keepout')).body.keepout, null);
  assert.equal((await call('PUT', '/api/routine', { text: ROUTINE + '\n# edit' })).status, 200);
  expectError(await call('PUT', '/api/routine', { enabled: false }), 409, 'ask_hermes');
  expectError(await call('PUT', '/api/routine', { text: '12:00 Edited', enabled: false }), 409, 'ask_hermes');
  assert.equal((await call('GET', '/api/routine')).body.enabled, true);
  assert.equal((await call('GET', '/api/keepout')).body.keepout, null);
});

test('window start and completion respect the minimum and expose keepout before, during and after', async (t) => {
  const { enable, status, call, at } = setup(t, '12:00');
  await enable();
  at('12:30');
  // Fixed proof items stay due after their slot ends.
  assert.equal((await status('done', '12:00-12:20')).status, 200);
  assert.equal((await call('GET', '/api/keepout')).body.keepout, null);
  expectError(await status('done', '12:30..14:00'), 409, 'not_due');
  const started = await status('start', '12:30..14:00');
  assert.equal(started.status, 200);
  const meal = started.body.today.items.find((item) => item.key === '12:30..14:00');
  assert.equal(meal.phase, 'locked');
  assert.equal(meal.startedAt, instant('12:30'));
  const lock = (await call('GET', '/api/keepout')).body.keepout;
  assert.equal(lock.key, meal.key);
  assert.equal(lock.doneAfter, instant('12:50'));
  assert.equal(lock.canDone, false);
  expectError(await status('start', meal.key), 409, 'already');
  expectError(await status('done', meal.key), 409, 'too_soon');
  at('12:49');
  expectError(await status('done', meal.key), 409, 'too_soon');
  at('12:50');
  const done = await status('done', meal.key);
  assert.equal(done.status, 200);
  assert.equal(done.body.today.items.find((item) => item.key === meal.key).phase, 'done');
  assert.equal(done.body.today.items.find((item) => item.key === meal.key).doneAt, instant('12:50'));
  assert.equal((await call('GET', '/api/keepout')).body.keepout, null);
  expectError(await status('start', meal.key), 409, 'already');
  expectError(await status('done', meal.key), 409, 'not_due');
});

test('starting a non-keepout window is refused without writing status', async (t) => {
  const { enable, status, call, DB } = setup(t);
  assert.equal((await enable('12:00..13:00 Free')).status, 200);
  assert.equal((await call('GET', '/api/keepout')).body.keepout, null);
  expectError(await status('start', '12:00..13:00'), 409, 'not_open');
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_status').get().n, 0);
});

test('starting a window is blocked by an earlier unfinished lock and allowed after completion', async (t) => {
  const { enable, status, call, at, DB } = setup(t, '12:00');
  await enable();
  at('12:30');
  assert.equal((await call('GET', '/api/keepout')).body.keepout.key, '12:00-12:20');
  expectError(await status('start', '12:30..14:00'), 409, 'locked');
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_status').get().n, 0);
  assert.equal((await status('done', '12:00-12:20')).status, 200);
  assert.equal((await call('GET', '/api/keepout')).body.keepout, null);
  const started = await status('start', '12:30..14:00');
  assert.equal(started.status, 200);
  assert.equal(started.body.today.keepout.key, '12:30..14:00');
  assert.equal(started.body.today.items.find((item) => item.key === '12:30..14:00').startedAt, instant('12:30'));
  expectError(await status('start', '12:30..14:00'), 409, 'already');
});

test('later locks cannot be completed before the current keepout is done', async (t) => {
  const { enable, status, call, at, DB } = setup(t, '12:00');
  await enable();
  at('14:00');
  assert.equal((await call('GET', '/api/keepout')).body.keepout.key, '12:00-12:20');
  expectError(await status('start', '12:30..14:00'), 409, 'locked');
  expectError(await status('done', '12:30..14:00'), 409, 'locked');
  at('14:20');
  expectError(await status('done', '12:30..14:00'), 409, 'locked');
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_status').get().n, 0);
  assert.equal((await call('GET', '/api/keepout')).body.keepout.key, '12:00-12:20');
  assert.equal((await status('done', '12:00-12:20')).status, 200);
  assert.equal((await call('GET', '/api/keepout')).body.keepout.key, '12:30..14:00');
  assert.equal((await status('done', '12:30..14:00')).status, 200);
  assert.equal((await call('GET', '/api/keepout')).body.keepout, null);
});

test('start and done reject the wrong day, unopened and unknown items, free time and sleep', async (t) => {
  const { enable, status, at, DB } = setup(t, '12:00');
  await enable();
  expectError(await status('start', '12:30..14:00'), 409, 'locked');
  expectError(await status('start', 'missing'), 404, 'not_found');
  expectError(await status('start', '12:00-12:20'), 409, 'not_open');
  expectError(await status('start', '12:30..14:00', '2026-10-04'), 409, 'not_open');
  expectError(await status('done', '12:00-12:20', '2026-10-04'), 409, 'not_due');
  expectError(await status('done', 'missing'), 409, 'not_due');
  expectError(await status('done', '14:00-02:30'), 409, 'locked');
  at('03:00', '2026-10-06');
  expectError(await status('done', '02:30-12:00'), 409, 'locked');
  expectError(await status('start', '14:00-02:30'), 409, 'locked');
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_status').get().n, 0);
  await status('done', '12:00-12:20');
  await status('done', '12:30..14:00');
  expectError(await status('done', '02:30-12:00'), 409, 'not_due');
});

test('new-day materialization prunes old status without start or done, keeping yesterday and other owners', async (t) => {
  const { enable, call, DB, at } = setup(t);
  at('12:00', '2026-10-04');
  await enable();
  const insert = DB.raw.prepare('INSERT INTO routine_status (sub, day, key, done_at) VALUES (?, ?, ?, ?)');
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
  for (const day of days) insert.run('owner', day, 'old', 1);
  insert.run('other', '2026-10-01', 'old', 1);
  at('03:00'); // Before noon: the current instance is still October 4.
  assert.equal((await call('GET', '/api/routine')).body.today.day, '2026-10-04');
  assert.deepEqual(DB.raw.prepare('SELECT day FROM routine_status WHERE sub = ? ORDER BY day').all('owner')
    .map((row) => row.day), days);
  at('12:00');
  const next = await call('GET', '/api/routine');
  assert.equal(next.status, 200);
  assert.equal(next.body.today.day, '2026-10-05');
  assert.equal(DB.raw.prepare('SELECT materialized_day FROM routines').get().materialized_day, '2026-10-05');
  assert.deepEqual(DB.raw.prepare('SELECT day FROM routine_status WHERE sub = ? ORDER BY day').all('owner')
    .map((row) => row.day), ['2026-10-04', '2026-10-05']);
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_status WHERE sub = ?').get('other').n, 1);
});

test('enabling at 02:10 skips ended keepouts while ongoing and next items still lock', async (t) => {
  const { enable, call, status, at, DB } = setup(t, '02:10');
  const text = `12:00-12:20 Wake ! until wake, done
12:30..14:00 Meal ! until photo; min 20m
14:00-sunset-1h Free
sunset-1h..sunset Outing ! until away 30m, photo
sunset-02:00 Free
02:00-02:30 Hygiene ! until done
02:30-12:00 Sleep !`;
  const enabled = await enable(text);
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.today.day, '2026-10-04');
  assert.equal(enabled.body.today.keepout.key, '02:00-02:30');
  const earlier = enabled.body.today.items.filter((item) => item.end <= instant('02:10'));
  assert.ok(earlier.length > 0);
  assert.ok(earlier.every((item) => !item.keepout && !['locked', 'missed'].includes(item.phase)));
  for (const key of ['12:30..14:00', 'sunset-1h..sunset']) {
    assert.equal(earlier.find((item) => item.key === key).keepout, false);
    expectError(await status('done', key, '2026-10-04'), 409, 'locked');
  }
  const hygiene = enabled.body.today.items.find((item) => item.key === '02:00-02:30');
  assert.equal(hygiene.keepout, true);
  assert.equal(hygiene.phase, 'locked');
  assert.equal((await status('done', hygiene.key, '2026-10-04')).status, 200);
  assert.equal((await call('GET', '/api/keepout')).body.keepout, null);
  assert.equal(DB.raw.prepare('SELECT enabled_at FROM routines').get().enabled_at, instant('02:10'));
  at('02:30');
  const current = (await call('GET', '/api/routine')).body.today;
  assert.equal(current.items.find((item) => item.key === '02:30-12:00').phase, 'locked');
  assert.equal((await call('GET', '/api/keepout')).body.keepout.key, '02:30-12:00');
  at('12:00');
  assert.equal((await call('GET', '/api/routine')).body.today.items[0].phase, 'locked');
});

test('enabling before the day preserves overdue locks and minimum completion times', async (t) => {
  const { enable, call, status, at } = setup(t, '11:59');
  await enable();
  at('12:00');
  assert.equal((await call('GET', '/api/routine')).body.today.items[0].phase, 'locked');
  at('14:00');
  const current = (await call('GET', '/api/routine')).body.today;
  assert.equal(current.items.find((item) => item.key === '12:30..14:00').phase, 'locked');
  assert.equal(current.keepout.key, '12:00-12:20');
  expectError(await status('done', '12:30..14:00'), 409, 'locked');
  assert.equal((await status('done', '12:00-12:20')).status, 200);
  expectError(await status('done', '12:30..14:00'), 409, 'too_soon');
  at('14:20');
  assert.equal((await status('done', '12:30..14:00')).status, 200);
  assert.equal((await call('GET', '/api/keepout')).body.keepout, null);
});

test('opt-in time changes only on enabling, and an operator off/on during an open window keeps it owed', async (t) => {
  const { enable, call, status, at, DB } = setup(t);
  await call('PUT', '/api/routine', { text: ROUTINE });
  const enabledAt = () => DB.raw.prepare('SELECT enabled_at FROM routines').get().enabled_at;
  assert.equal(enabledAt(), 0);
  await call('PUT', '/api/routine', { enabled: true });
  assert.equal(enabledAt(), instant('12:30'));
  expectError(await status('done', '12:00-12:20'), 409, 'not_due');
  at('13:00');
  assert.equal((await enable(ROUTINE + '\n# note')).status, 200);
  assert.equal(enabledAt(), instant('12:30'));
  expectError(await call('PUT', '/api/routine', { enabled: false }), 409, 'ask_hermes');
  DB.raw.prepare('UPDATE routines SET enabled = 0 WHERE sub = ?').run('owner');
  assert.equal(enabledAt(), instant('12:30'));
  const reenabled = await call('PUT', '/api/routine', { enabled: true });
  assert.equal(reenabled.status, 200);
  assert.equal(enabledAt(), instant('13:00'));
  const meal = reenabled.body.today.items.find((item) => item.key === '12:30..14:00');
  assert.equal(meal.keepout, true);
  assert.equal(meal.phase, 'open');
  at('14:00');
  assert.equal((await call('GET', '/api/keepout')).body.keepout.key, meal.key);
  expectError(await status('done', meal.key), 409, 'too_soon');
  at('14:20');
  assert.equal((await status('done', meal.key)).status, 200);
  assert.equal((await call('GET', '/api/keepout')).body.keepout, null);
  at('12:30', '2026-10-06');
  await status('done', '12:00-12:20', '2026-10-06');
  assert.equal((await status('start', '12:30..14:00', '2026-10-06')).body.today.keepout.key, '12:30..14:00');
});

test('items ending exactly at opt-in are skipped', async (t) => {
  const { enable, call, status } = setup(t, '12:20');
  const enabled = await enable();
  assert.equal(enabled.body.today.items[0].keepout, false);
  assert.equal(enabled.body.today.items[0].phase, 'past');
  assert.equal((await call('GET', '/api/keepout')).body.keepout, null);
  expectError(await status('done', '12:00-12:20'), 409, 'not_due');
});

test('existing enabled rows retain keepout behavior with the migration default', async (t) => {
  const { call, DB } = setup(t);
  DB.raw.prepare('INSERT INTO routines (sub, text, enabled, updated_at) VALUES (?, ?, 1, ?)')
    .run('owner', ROUTINE, Date.now());
  assert.equal(DB.raw.prepare('SELECT enabled_at FROM routines').get().enabled_at, 0);
  assert.equal((await call('GET', '/api/keepout')).body.keepout.key, '12:00-12:20');
});

test('RoutineError on reread leaves the routine unavailable and preserves the manual plan', async (t) => {
  const { call, DB } = setup(t);
  const manual = { text: '12:00-13:00 Manual', anchor: instant('00:00') };
  await call('PUT', '/api/schedule', manual);
  DB.raw.prepare('INSERT INTO routines (sub, text, enabled, lat, updated_at) VALUES (?, ?, 1, 90, ?)')
    .run('owner', 'sunset..sunset+1h Outing ! until done', Date.now());
  const routine = (await call('GET', '/api/routine')).body;
  assert.equal(routine.enabled, true);
  assert.equal(routine.today, null);
  assert.equal((await call('GET', '/api/keepout')).body.keepout, null);
  assert.deepEqual((await call('GET', '/api/me')).body.schedule, manual);
  assert.equal((await call('GET', '/api/watch')).status, 200);
  assert.equal((await call('GET', '/api/board')).status, 200);
  assert.equal(DB.raw.prepare('SELECT materialized_day FROM routines').get().materialized_day, null);
});
