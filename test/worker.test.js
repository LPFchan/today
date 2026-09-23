import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { testDatabase } from './d1.js';

const ORIGIN = 'https://today.lost.plus';

// Headers exactly as the gateway injects them.
function as(sub, name) {
  return {
    'x-lost-plus-encoding': 'percent-utf8',
    'x-lost-plus-sub': encodeURIComponent(sub),
    'x-lost-plus-email': encodeURIComponent(`${sub}@example.com`),
    'x-lost-plus-name': encodeURIComponent(name),
    'x-lost-plus-role': 'user',
  };
}

function client(env) {
  return async (method, path, { headers = {}, body } = {}) => {
    const init = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers['content-type'] = 'application/json';
    }
    const response = await worker.fetch(new Request(ORIGIN + path, init), env);
    const type = response.headers.get('content-type') ?? '';
    return { status: response.status, headers: response.headers, body: type.includes('json') ? await response.json() : await response.text() };
  };
}

const midnight = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

test('the API refuses a request with no gateway identity', async () => {
  const call = client({ DB: testDatabase() });
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('GET', '/api/watch')).status, 401);
  // A half-formed identity is no identity.
  assert.equal((await call('GET', '/api/me', { headers: { 'x-lost-plus-sub': '1' } })).status, 401);
});

test('saving, reading and clearing a schedule', async () => {
  const call = client({ DB: testDatabase() });
  const me = as('1', 'Yeowool Kim');

  const first = await call('GET', '/api/me', { headers: me });
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { me: { sub: '1', name: 'Yeowool Kim', email: '1@example.com' }, visibility: 'private', schedule: null });

  const saved = await call('PUT', '/api/schedule', { headers: me, body: { text: '09:00 Work\n12:00-13:00 점심', anchor: midnight() } });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.schedule.text, '09:00-12:00 Work\n12:00-13:00 점심');

  const bad = await call('PUT', '/api/schedule', { headers: me, body: { text: '10:00 A\n09:00 B', anchor: midnight() } });
  assert.equal(bad.status, 422);
  assert.deepEqual(bad.body, { error: 'backwards', line: 2 });

  const farAnchor = await call('PUT', '/api/schedule', { headers: me, body: { text: '09:00 A', anchor: 0 } });
  assert.equal(farAnchor.status, 400);

  const cleared = await call('DELETE', '/api/schedule', { headers: me });
  assert.equal(cleared.body.schedule, null);
});

test('the board shows public people and yourself, never private others', async () => {
  const call = client({ DB: testDatabase() });
  const yeowool = as('1', 'yeowool');
  const marie = as('2', 'marie');
  const shy = as('3', 'shy');
  const anchor = midnight();

  for (const who of [yeowool, marie, shy]) {
    await call('PUT', '/api/schedule', { headers: who, body: { text: '00:00-23:59 Being', anchor } });
  }
  await call('PUT', '/api/visibility', { headers: marie, body: { visibility: 'public' } });
  assert.equal((await call('PUT', '/api/visibility', { headers: marie, body: { visibility: 'unlisted' } })).status, 400);

  const board = await call('GET', '/api/board', { headers: yeowool });
  assert.deepEqual(
    board.body.people.map((p) => [p.name, p.me]),
    [
      ['yeowool', true],
      ['marie', false],
    ],
  );
  assert.equal(board.body.people[1].items[0].name, 'Being');
  assert.ok(!JSON.stringify(board.body).includes('"sub"'));

  const shyBoard = await call('GET', '/api/board', { headers: shy });
  assert.deepEqual(
    shyBoard.body.people.map((p) => p.name),
    ['shy', 'marie'],
  );
});

test('the watch gets epoch seconds and byte-bounded names', async () => {
  const call = client({ DB: testDatabase() });
  const me = as('1', 'yeowool');
  const anchor = midnight();
  const long = '아주 긴 이름을 가진 일정은 워치에서 잘려야 해요 정말로 정말로 정말로';
  await call('PUT', '/api/schedule', { headers: me, body: { text: `09:00-10:00 ${long}`, anchor } });

  const watch = await call('GET', '/api/watch', { headers: me });
  assert.equal(watch.status, 200);
  const [[start, end, name]] = watch.body.items;
  assert.equal(start, anchor / 1000 + 9 * 3600);
  assert.equal(end, anchor / 1000 + 10 * 3600);
  assert.ok(new TextEncoder().encode(name).length <= 60);
  assert.ok(name.endsWith('…'));
});

test('pairing: new, open, done, poll', async () => {
  const env = { DB: testDatabase() };
  const call = client(env);

  assert.equal((await call('POST', '/pair/new', { body: { client_id: 'nope' } })).status, 400);

  const created = await call('POST', '/pair/new', { body: { client_id: 'lpc_' + 'a'.repeat(32) } });
  assert.equal(created.status, 200);
  const { id, secret, verifier, url } = created.body;
  assert.match(id, /^[a-z0-9]{10}$/);
  assert.equal(url, `${ORIGIN}/pair/${id}`);

  // The QR link sends the browser to the hub with a matching PKCE challenge.
  const open = await call('GET', `/pair/${id}`);
  assert.equal(open.status, 302);
  const authorize = new URL(open.headers.get('location'));
  assert.equal(authorize.origin + authorize.pathname, 'https://auth.lost.plus/oauth/authorize');
  assert.equal(authorize.searchParams.get('resource'), `${ORIGIN}/mcp`);
  assert.equal(authorize.searchParams.get('scope'), 'today');
  assert.equal(authorize.searchParams.get('state'), id);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  assert.equal(authorize.searchParams.get('code_challenge'), Buffer.from(digest).toString('base64url'));

  assert.equal((await call('POST', '/pair/poll', { body: { id, secret } })).status, 202);
  assert.equal((await call('POST', '/pair/poll', { body: { id, secret: 'wrong' } })).status, 403);

  const done = await call('GET', `/pair/done?code=abc123&state=${id}`);
  assert.equal(done.status, 200);
  assert.match(done.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  // A second callback cannot replace the code.
  assert.equal((await call('GET', `/pair/done?code=evil&state=${id}`)).status, 410);

  const polled = await call('POST', '/pair/poll', { body: { id, secret } });
  assert.deepEqual(polled.body, { code: 'abc123' });
  // Taken once, then gone.
  assert.equal((await call('POST', '/pair/poll', { body: { id, secret } })).status, 410);
  assert.equal((await call('GET', `/pair/${id}`)).status, 410);
});

test('pairing ignores identity headers entirely', async () => {
  const call = client({ DB: testDatabase() });
  const created = await call('POST', '/pair/new', { headers: as('1', 'x'), body: { client_id: 'lpc_' + 'b'.repeat(32) } });
  assert.equal(created.status, 200);
});

test('declining on the hub cancels the pairing', async () => {
  const call = client({ DB: testDatabase() });
  const { id, secret } = (await call('POST', '/pair/new', { body: { client_id: 'lpc_' + 'c'.repeat(32) } })).body;
  const declined = await call('GET', `/pair/done?error=access_denied&state=${id}`);
  assert.equal(declined.status, 200);
  assert.equal((await call('POST', '/pair/poll', { body: { id, secret } })).status, 410);
});

test('the Mac download goes to the newest release in the Sparkle feed', async () => {
  const call = client({ DB: testDatabase() });
  const realFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(`<item><enclosure url="https://github.com/LPFchan/today/releases/download/mac-v1.0.1/Today.dmg" /></item>
      <item><enclosure url="https://github.com/LPFchan/today/releases/download/mac-v1.0.0/today.dmg" /></item>`);
    const newest = await call('GET', '/download/mac');
    assert.equal(newest.status, 302);
    assert.equal(newest.headers.get('location'), 'https://github.com/LPFchan/today/releases/download/mac-v1.0.1/Today.dmg');

    globalThis.fetch = async () => new Response('', { status: 404 });
    const missing = await call('GET', '/download/mac');
    assert.equal(missing.headers.get('location'), 'https://github.com/LPFchan/today/releases/');
  } finally {
    globalThis.fetch = realFetch;
  }
});
