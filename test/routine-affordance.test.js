import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { testDatabase } from './d1.js';

const TEXT = `12:00 Wake ! until wake
12:00 Wash ! until done
12:30..14:00 Meal ! until photo; min 20m
03:00-12:00 Sleep !`;
const instant = (time, day = '2026-10-05') => Date.parse(`${day}T${time}:00+09:00`);
const id = (n = 1) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function setup(t, time = '12:00') {
  let now = instant(time);
  t.mock.method(Date, 'now', () => now);
  const DB = testDatabase();
  t.after(() => DB.raw.close());
  const call = async (method, path, body, sub = 'owner', extra = {}) => {
    const headers = { ...extra };
    if (sub !== null) Object.assign(headers, {
      'x-lost-plus-encoding': 'percent-utf8', 'x-lost-plus-sub': encodeURIComponent(sub),
      'x-lost-plus-email': `${sub}@example.com`, 'x-lost-plus-name': sub, 'x-lost-plus-role': 'user',
    });
    const response = await worker.fetch(new Request(`https://today.lost.plus${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), { DB });
    return { status: response.status, body: await response.json() };
  };
  return { DB, call, at: (time, day) => { now = instant(time, day); },
    enable: (text = TEXT) => call('PUT', '/api/routine', { text, enabled: true }),
    bypass: (key = '12:00', n = 1, extra = {}) => call('POST', '/api/routine/affordance',
      { action: 'bypass', day: '2026-10-05', key, reason: 'Sick today', requestId: id(n), ...extra }),
    off: (n = 1) => call('POST', '/api/routine/affordance',
      { action: 'off', day: '2026-10-05', reason: 'Rest today', requestId: id(n) }),
    report: (day = '2026-10-05', sub = 'owner') => call('GET', `/api/routine/report?day=${day}`, undefined, sub),
  };
}

test('gateway subject is required; no Authorization heuristic or body-selected identity', async (t) => {
  const { call, enable, bypass } = setup(t);
  for (const extra of [{ cookie: 'session=browser' }, { authorization: 'Bearer shared-today-token' }]) {
    assert.equal((await call('POST', '/api/routine/affordance', {}, null, extra)).status, 401);
    assert.equal((await call('GET', '/api/routine/report?day=2026-10-04', undefined, null, extra)).status, 401);
  }
  await enable();
  assert.equal((await bypass('12:00', 1, { sub: 'another' })).status, 400);
  // The gateway removes credentials before forwarding. An admitted request
  // has identity only; machine-only routing must be tested in the auth slice.
  assert.equal((await bypass()).status, 200);
});

test('strict action shape, reason, date, key and UUID validation', async (t) => {
  const { bypass, call, enable } = setup(t);
  await enable();
  for (const change of [{ action: 'done' }, { day: '2026-02-30' }, { day: 5 }, { key: '' },
    { key: 'x'.repeat(101) }, { key: 1 }, { reason: '' }, { reason: ' ' }, { reason: null },
    { reason: '🦊'.repeat(201) }, { requestId: 'not-a-uuid' }, { requestId: 1 }]) {
    assert.equal((await bypass('12:00', 1, change)).status, 400);
  }
  assert.equal((await call('POST', '/api/routine/affordance', {
    action: 'off', day: '2026-10-05', key: '12:00', reason: 'Rest', requestId: id(),
  })).status, 400);
});

test('opt-out, ordered locks, exact item and future/stale day pinning', async (t) => {
  const { bypass, enable, call, at, DB } = setup(t);
  assert.equal((await bypass()).status, 409);
  await enable();
  assert.equal((await bypass('12:00#2')).body.error, 'locked');
  for (const day of ['2026-10-04', '2026-10-06']) assert.equal((await bypass('12:00', 1, { day })).status, 409);
  assert.equal((await bypass()).status, 200);
  const profile = (await call('GET', '/api/routine')).body;
  assert.equal(profile.today.items[0].phase, 'bypassed');
  assert.equal(profile.today.items[0].doneAt, null);
  assert.deepEqual(profile.today.items[0].proofs, {});
  assert.equal(profile.today.keepout.key, '12:00#2');
  assert.equal((await bypass('12:30..14:00', 2)).status, 409);
  assert.equal((await bypass('12:00#2', 2)).status, 200);
  assert.equal((await bypass('12:30..14:00', 3)).status, 409);
  at('12:30');
  assert.equal((await bypass('12:30..14:00', 3)).status, 200);
  assert.equal((await call('GET', '/api/keepout?proof=photo')).body.item, null);
  assert.equal((await call('POST', '/api/routine/proof', {
    day: '2026-10-05', key: '12:30..14:00', proof: 'photo',
  })).status, 409);
  at('03:00', '2026-10-06');
  assert.equal((await bypass('03:00-12:00', 4)).status, 409);
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_affordances').get().n, 3);
});

test('first-write receipts, duplicate concurrency and payload conflict survive rollover', async (t) => {
  const { enable, bypass, at, DB } = setup(t);
  await enable();
  const results = await Promise.all([bypass(), bypass()]);
  assert.ok(results.every((result) => result.status === 200));
  assert.deepEqual(results[0].body, results[1].body);
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_affordances').get().n, 1);
  assert.equal((await bypass('12:00', 1, { reason: 'Changed reason' })).body.error, 'request_conflict');
  at('12:00', '2026-10-06');
  assert.deepEqual((await bypass()).body, results[0].body);
  assert.equal((await bypass('12:00', 2)).status, 409);
});

test('different concurrent receipts cannot bypass the same item twice', async (t) => {
  const { enable, bypass, DB } = setup(t);
  await enable();
  const results = await Promise.all([bypass('12:00', 1), bypass('12:00', 2)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_affordances').get().n, 1);
});

test('concurrent off requests produce exactly one accepted event', async (t) => {
  const { enable, off, DB } = setup(t);
  await enable();
  const results = await Promise.all([off(1), off(2)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_affordances').get().n, 1);
  assert.equal(DB.raw.prepare('SELECT enabled FROM routines').get().enabled, 0);
});

test('bypass preserves real partial proof history', async (t) => {
  const { enable, call, bypass, DB } = setup(t);
  await enable('12:00 Wake ! until wake, done');
  await call('POST', '/api/routine/proof', { proof: 'wake', note: 'Alarm acknowledged' });
  const before = DB.raw.prepare('SELECT proofs FROM routine_status').get().proofs;
  assert.equal((await bypass()).status, 200);
  assert.equal(DB.raw.prepare('SELECT proofs FROM routine_status').get().proofs, before);
  assert.equal(DB.raw.prepare('SELECT done_at FROM routine_status').get().done_at, null);
  const item = (await call('GET', '/api/routine')).body.today.items[0];
  assert.equal(item.phase, 'bypassed');
  assert.equal(item.proofs.wake.note, 'Alarm acknowledged');
});

test('off releases keepout atomically, retains receipt and denies self-service off', async (t) => {
  const { enable, off, call, DB, at, report } = setup(t);
  await enable();
  assert.equal((await call('PUT', '/api/routine', { enabled: false })).body.error, 'ask_hermes');
  const first = await off();
  assert.equal(first.status, 200);
  assert.equal((await call('GET', '/api/routine')).body.enabled, false);
  assert.equal((await call('GET', '/api/keepout')).body.keepout, null);
  assert.deepEqual(await off(), first);
  assert.equal((await off(2)).status, 409);
  assert.equal(DB.raw.prepare('SELECT stopped_at FROM routine_days').get().stopped_at, Date.now());
  at('12:00', '2026-10-06');
  const result = await report();
  assert.equal(result.status, 200);
  assert.equal(result.body.events[0].action, 'off');
  assert.ok(result.body.instances[0].items.slice(2).every((item) => item.outcome === 'skipped'));
});

test('reports and receipts are scoped to gateway subject', async (t) => {
  const { enable, bypass, call, report, at } = setup(t);
  await enable();
  await bypass();
  assert.equal((await call('POST', '/api/routine/affordance', {
    action: 'bypass', day: '2026-10-05', key: '12:00', reason: 'Sick today', requestId: id(),
  }, 'other')).status, 409);
  at('12:00', '2026-10-06');
  assert.equal((await report()).body.events.length, 1);
  const other = (await report('2026-10-05', 'other')).body;
  assert.equal(other.coverage, 'missing');
  assert.deepEqual(other.events, []);
  assert.deepEqual(other.missed, []);
});

test('report retains late proof, deadline miss and bypass after pruning and pending edit', async (t) => {
  const { enable, bypass, call, at, report, DB } = setup(t);
  await enable();
  await bypass();
  await bypass('12:00#2', 2);
  await call('PUT', '/api/routine', { text: '13:00-14:00 New ! until done' });
  at('14:20');
  assert.equal((await call('POST', '/api/routine/proof', {
    day: '2026-10-05', key: '12:30..14:00', proof: 'photo', note: 'Lunch late',
  })).status, 200);
  at('14:00', '2026-10-08');
  const result = await report();
  assert.equal(result.status, 200);
  const meal = result.body.instances[0].items.find((item) => item.name === 'Meal');
  assert.equal(meal.outcome, 'done');
  assert.equal(meal.missedDeadline, true);
  assert.equal(meal.proofs.photo.note, 'Lunch late');
  assert.equal(result.body.events.length, 2);
  assert.equal(result.body.instances[0].ends, instant('12:00', '2026-10-06'));
  assert.equal(DB.raw.prepare("SELECT count(*) AS n FROM routine_status WHERE day = '2026-10-05'").get().n, 0);
});

test('enable mid-day skips ended slots; open meal remains owed', async (t) => {
  const { enable, at, report } = setup(t, '13:00');
  await enable();
  at('12:00', '2026-10-06');
  const result = await report();
  const items = result.body.instances[0].items;
  assert.equal(items[0].outcome, 'skipped');
  assert.equal(items[1].outcome, 'skipped');
  assert.equal(items[2].outcome, 'missed');
  assert.equal(items[2].missedDeadline, true);
});

test('away, absent history and unobserved days never become invented misses', async (t) => {
  const { enable, call, at, report, bypass } = setup(t);
  await enable();
  await call('PUT', '/api/routine/away', { day: '2026-10-06', away: true, reason: 'Trip' });
  at('12:00', '2026-10-06');
  await call('GET', '/api/routine');
  assert.equal((await bypass('12:00', 1, { day: '2026-10-06' })).status, 409);
  at('12:00', '2026-10-08');
  assert.deepEqual((await report('2026-10-06')).body.missed, []);
  assert.equal((await report('2026-10-07')).body.coverage, 'missing');
  assert.equal((await report('2026-10-04')).body.completed, null);
  assert.equal((await report('2026-10-08')).body.error, 'day_incomplete');
  assert.equal((await report('2026-02-30')).status, 400);
});

test('first observation after deadline has partial coverage; retention removes expired history', async (t) => {
  const { DB, call, at, report } = setup(t, '16:00');
  DB.raw.prepare('INSERT INTO routines (sub, text, enabled, enabled_at, updated_at) VALUES (?, ?, 1, ?, ?)')
    .run('owner', TEXT, instant('12:00'), instant('12:00'));
  await call('GET', '/api/routine');
  at('12:00', '2026-10-06');
  const result = await report();
  assert.equal(result.body.coverage, 'partial');
  assert.deepEqual(result.body.missed, []);
  at('12:01', '2026-10-14');
  assert.equal((await report()).body.coverage, 'missing');
});

test('eligibility changes before the atomic batch create no event or receipt', async (t) => {
  const { enable, bypass, DB } = setup(t);
  await enable();
  const batch = DB.batch.bind(DB);
  t.mock.method(DB, 'batch', async (statements) => {
    DB.raw.prepare('INSERT INTO routine_status (sub, day, key, done_at) VALUES (?, ?, ?, ?)')
      .run('owner', '2026-10-05', '12:00', Date.now());
    return batch(statements);
  });
  assert.equal((await bypass()).body.error, 'state_changed');
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_affordances').get().n, 0);
});

test('an off transaction failure rolls back its event and stop boundary', async (t) => {
  const { enable, off, DB } = setup(t);
  await enable();
  DB.raw.exec("CREATE TRIGGER fail_off BEFORE UPDATE OF enabled ON routines WHEN NEW.enabled = 0 BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
  t.mock.method(console, 'error', () => {});
  assert.equal((await off()).status, 500);
  assert.equal(DB.raw.prepare('SELECT enabled FROM routines').get().enabled, 1);
  assert.equal(DB.raw.prepare('SELECT stopped_at FROM routine_days').get().stopped_at, null);
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_affordances').get().n, 0);
});

test('a delayed proof cannot mutate a bypassed item or a switched-off routine', async (t) => {
  const { enable, call, bypass, off, DB } = setup(t);
  await enable();
  const prepare = DB.prepare.bind(DB);
  let pause;
  let resume;
  const paused = new Promise((resolve) => { pause = resolve; });
  const resumed = new Promise((resolve) => { resume = resolve; });
  t.mock.method(DB, 'prepare', (sql) => {
    const statement = prepare(sql);
    if (!sql.startsWith('INSERT INTO routine_status (sub, day, key, proofs)')) return statement;
    return { ...statement, bind: (...values) => {
      const bound = statement.bind(...values);
      return { ...bound, run: async () => { pause(); await resumed; return bound.run(); } };
    } };
  });
  const proof = call('POST', '/api/routine/proof', { proof: 'wake', day: '2026-10-05', key: '12:00' });
  await paused;
  try {
    assert.equal((await bypass()).status, 200);
    assert.equal((await off(2)).status, 200);
  } finally { resume(); }
  assert.equal((await proof).body.error, 'state_changed');
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_status').get().n, 0);
});

test('off/edit/re-enable preserves earlier snapshots and never transfers bypass to a revised item', async (t) => {
  const { enable, bypass, off, call, at, report, DB } = setup(t, '13:00');
  const old = '12:30..14:00 Meal ! until photo';
  await enable(old);
  await bypass('12:30..14:00');
  await off(2);
  // Identical clock milliseconds still create a distinct opt-in instance.
  await enable('12:30..14:00 Revised outing ! until away 30m, photo');
  const profile = (await call('GET', '/api/routine')).body;
  assert.equal(profile.today.items[0].phase, 'open');
  assert.equal(profile.today.items[0].bypass, undefined);
  assert.equal((await off(2)).status, 200);
  assert.equal((await call('GET', '/api/routine')).body.enabled, true);
  assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_days').get().n, 2);
  at('12:30', '2026-10-06');
  const result = await report();
  assert.deepEqual(result.body.instances.map((instance) => instance.items[0].name), ['Meal', 'Revised outing']);
  assert.equal(result.body.instances[0].items[0].outcome, 'bypassed');
  assert.equal(result.body.instances[1].items[0].outcome, 'missed');
});

test('same-key re-enable permits a fresh bypass and keeps old receipt replay inert', async (t) => {
  const { enable, bypass, off, call, at, report, DB } = setup(t, '13:00');
  const text = '12:30..14:00 Meal ! until photo';
  const key = '12:30..14:00';
  await enable(text);
  const original = await bypass(key, 1);
  assert.equal(original.status, 200);
  await off(2);
  await enable(text);
  assert.deepEqual(await bypass(key, 1), original);
  const item = (await call('GET', '/api/routine')).body.today.items[0];
  assert.equal(item.phase, 'open');
  assert.equal(item.bypass, undefined);
  const results = await Promise.all([bypass(key, 3), bypass(key, 4)]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const accepted = results.find((result) => result.status === 200);
  assert.notEqual(accepted.body.receipt.instance, original.body.receipt.instance);
  assert.equal((await call('GET', '/api/routine')).body.today.items[0].phase, 'bypassed');
  assert.equal(DB.raw.prepare("SELECT count(*) AS n FROM routine_affordances WHERE action = 'bypass'").get().n, 2);
  at('12:30', '2026-10-06');
  const history = (await report()).body;
  assert.deepEqual(history.instances.map((instance) => instance.items[0].outcome), ['bypassed', 'bypassed']);
});

for (const completion of ['partial', 'proof', 'done']) {
  test(`same-key re-enable clears ${completion} status while preserving earlier evidence`, async (t) => {
    const { enable, call, off, at, report, DB } = setup(t, '13:00');
    const key = '12:30..14:00';
    const text = '12:30..14:00 Outing ! until away 30m, photo';
    await enable(text);
    await call('POST', '/api/routine/start', { day: '2026-10-05', key });
    at('13:01');
    if (completion === 'done') {
      assert.equal((await call('POST', '/api/routine/done', { day: '2026-10-05', key })).status, 200);
    } else {
      assert.equal((await call('POST', '/api/routine/proof', { day: '2026-10-05', key, proof: 'photo', note: 'Real photo' })).status, 200);
      if (completion === 'proof') {
        assert.equal((await call('POST', '/api/routine/proof', { day: '2026-10-05', key, proof: 'away', note: 'Verified outing' })).status, 200);
      }
    }
    const original = (await call('GET', '/api/routine')).body.today.items[0];
    await off();
    const snapshot = DB.raw.prepare('SELECT statuses FROM routine_days WHERE instance = 0').get().statuses;
    await enable(text);
    const renewed = (await call('GET', '/api/routine')).body.today.items[0];
    assert.equal(renewed.phase, 'open');
    assert.equal(renewed.startedAt, null);
    assert.equal(renewed.doneAt, null);
    assert.deepEqual(renewed.proofs, {});
    assert.equal(DB.raw.prepare('SELECT statuses FROM routine_days WHERE instance = 0').get().statuses, snapshot);
    assert.equal(DB.raw.prepare('SELECT count(*) AS n FROM routine_status').get().n, 0);
    assert.ok(original.startedAt !== null);
    at('12:30', '2026-10-06');
    const instances = (await report()).body.instances;
    assert.equal(instances[0].items[0].outcome, completion === 'partial' ? 'released' : 'done');
    assert.equal(instances[1].items[0].outcome, 'missed');
    if (completion !== 'done') assert.equal(instances[0].items[0].proofs.photo.note, 'Real photo');
  });
}

test('receipt replay is stable, but its bypass never carries into tomorrow', async (t) => {
  const { enable, bypass, call, at } = setup(t);
  await enable();
  const receipt = await bypass();
  at('12:00', '2026-10-06');
  assert.deepEqual(await bypass(), receipt);
  assert.equal((await call('GET', '/api/keepout')).body.keepout.key, '12:00');
});

test('removing an observed away day starts coverage at its first active observation', async (t) => {
  const { enable, call, at, report } = setup(t);
  await enable();
  await call('PUT', '/api/routine/away', { day: '2026-10-06', away: true });
  at('12:00', '2026-10-06');
  await call('GET', '/api/routine');
  at('13:00', '2026-10-06');
  await call('PUT', '/api/routine/away', { day: '2026-10-06', away: false });
  at('12:00', '2026-10-07');
  const result = await report('2026-10-06');
  assert.equal(result.body.instances[0].away, false);
  assert.equal(result.body.instances[0].observedAt, instant('13:00', '2026-10-06'));
  assert.equal(result.body.instances[0].items[0].outcome, 'unknown');
  assert.equal(result.body.instances[0].items[2].outcome, 'missed');
});
