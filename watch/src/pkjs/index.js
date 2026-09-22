// today — the phone half of the watch app.
//
// Signs in to lost.plus once through a QR code shown on the watch, then
// fetches your plan from today.lost.plus and hands it to the watch.
//
// Pairing, in short (the server half is in src/worker.js):
//   1. register an OAuth client with the hub (once)
//   2. POST /pair/new → a short link and the PKCE verifier
//   3. the watch shows the link as a QR; you scan it and approve on the hub
//   4. poll POST /pair/poll until the hub's code arrives, then redeem it with
//      the verifier at the hub's token endpoint
// The token is bound to today.lost.plus with scope `today`, so it can read your
// plan and nothing else. Tokens rotate on refresh and live in this app's
// localStorage.

var qrcode = require('qrcode-generator');

var BASE = 'https://today.lost.plus';
var HUB = 'https://auth.lost.plus';
var REDIRECT = BASE + '/pair/done';
var RESOURCE = BASE + '/mcp';
var REFRESH_EVERY_MS = 5 * 60 * 1000;
var POLL_EVERY_MS = 3000;
// The hub drops a client that is never authorized after a day.
var CLIENT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// In step with the STATUS_* values in src/c/today.c.
var STATUS = { OK: 0, CONNECTING: 1, PAIRING: 2, OFFLINE: 3 };

var pairing = null; // { id, secret, verifier, clientId }
var pollTimer = null;
var busy = false;

/* ---------- storage ---------- */

function load(key) {
  var value = localStorage.getItem(key);
  return value === null ? null : value;
}

function save(values) {
  Object.keys(values).forEach(function (key) {
    if (values[key] === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(values[key]));
  });
}

function signedIn() {
  return !!load('refresh_token');
}

function signOut() {
  save({ access_token: null, refresh_token: null, access_expires: null });
}

/* ---------- HTTP ---------- */

function request(method, url, options, done) {
  var xhr = new XMLHttpRequest();
  xhr.open(method, url, true);
  xhr.timeout = 15000;
  var body = null;
  if (options.json) {
    xhr.setRequestHeader('Content-Type', 'application/json');
    body = JSON.stringify(options.json);
  } else if (options.form) {
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    body = Object.keys(options.form)
      .map(function (key) {
        return encodeURIComponent(key) + '=' + encodeURIComponent(options.form[key]);
      })
      .join('&');
  }
  if (options.token) xhr.setRequestHeader('Authorization', 'Bearer ' + options.token);
  xhr.onload = function () {
    var data = null;
    try {
      data = JSON.parse(xhr.responseText);
    } catch (e) {}
    done(xhr.status, data);
  };
  xhr.onerror = xhr.ontimeout = function () {
    done(0, null);
  };
  xhr.send(body);
}

/* ---------- messages to the watch ---------- */

var queue = [];
var sending = false;

function send(message) {
  queue.push({ message: message, tries: 0 });
  pump();
}

function pump() {
  if (sending || !queue.length) return;
  sending = true;
  var next = queue[0];
  Pebble.sendAppMessage(
    next.message,
    function () {
      queue.shift();
      sending = false;
      pump();
    },
    function () {
      sending = false;
      if (++next.tries >= 3) queue.shift();
      setTimeout(pump, 400);
    }
  );
}

function sendStatus(status) {
  send({ Status: status });
}

function sendItems(items) {
  send({ Status: STATUS.OK, Count: items.length });
  items.forEach(function (item, index) {
    send({ Index: index, Start: item[0], End: item[1], Name: item[2] });
  });
}

function sendQr(url) {
  var qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  var size = qr.getModuleCount();
  var bytes = [];
  for (var i = 0; i < size * size; i++) {
    if (i % 8 === 0) bytes.push(0);
    if (qr.isDark(Math.floor(i / size), i % size)) bytes[bytes.length - 1] |= 1 << (7 - (i % 8));
  }
  send({ Qr: bytes, QrSize: size });
}

/* ---------- tokens ---------- */

function storeTokens(data) {
  save({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    access_expires: Date.now() + (data.expires_in || 3600) * 1000,
  });
}

function refreshTokens(done) {
  request(
    'POST',
    HUB + '/oauth/token',
    {
      form: {
        grant_type: 'refresh_token',
        refresh_token: load('refresh_token'),
        client_id: load('client_id'),
        resource: RESOURCE,
      },
    },
    function (status, data) {
      if (status === 200 && data && data.access_token) {
        storeTokens(data);
        done('ok');
      } else if (status === 400 || status === 401) {
        done('revoked');
      } else {
        done('offline');
      }
    }
  );
}

/* ---------- the plan ---------- */

function fetchPlan(retried) {
  if (!signedIn()) return startPairing();
  if (busy) return;

  if (Date.now() > Number(load('access_expires') || 0) - 60000) {
    busy = true;
    return refreshTokens(function (result) {
      busy = false;
      if (result === 'ok') fetchPlan(retried);
      else if (result === 'revoked') {
        signOut();
        startPairing();
      } else sendStatus(STATUS.OFFLINE);
    });
  }

  busy = true;
  request('GET', BASE + '/api/watch', { token: load('access_token') }, function (status, data) {
    busy = false;
    if (status === 200 && data && data.items) {
      sendItems(data.items);
    } else if (status === 401 && !retried) {
      // Expired early or rotated elsewhere: refresh once, then give up.
      save({ access_expires: 0 });
      fetchPlan(true);
    } else if (status === 401) {
      signOut();
      startPairing();
    } else {
      sendStatus(STATUS.OFFLINE);
    }
  });
}

/* ---------- pairing ---------- */

function ensureClient(done) {
  var id = load('client_id');
  var age = Date.now() - Number(load('client_created') || 0);
  if (id && (load('client_used') || age < CLIENT_MAX_AGE_MS)) return done(id);
  request(
    'POST',
    HUB + '/oauth/register',
    {
      json: {
        client_name: 'today for Pebble',
        redirect_uris: [REDIRECT],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
    },
    function (status, data) {
      if (status === 201 && data && data.client_id) {
        save({ client_id: data.client_id, client_created: Date.now(), client_used: null });
        done(data.client_id);
      } else {
        done(null);
      }
    }
  );
}

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  pairing = null;
}

function startPairing() {
  stopPolling();
  sendStatus(STATUS.CONNECTING);
  ensureClient(function (clientId) {
    if (!clientId) return sendStatus(STATUS.OFFLINE);
    request('POST', BASE + '/pair/new', { json: { client_id: clientId } }, function (status, data) {
      if (status !== 200 || !data || !data.id) return sendStatus(STATUS.OFFLINE);
      pairing = { id: data.id, secret: data.secret, verifier: data.verifier, clientId: clientId };
      sendQr(data.url);
      pollTimer = setTimeout(poll, POLL_EVERY_MS);
    });
  });
}

function poll() {
  var current = pairing;
  if (!current) return;
  request('POST', BASE + '/pair/poll', { json: { id: current.id, secret: current.secret } }, function (status, data) {
    if (pairing !== current) return;
    if (status === 200 && data && data.code) {
      stopPolling();
      redeem(data.code, current);
    } else if (status === 410) {
      startPairing(); // the code on screen expired; show a fresh one
    } else {
      pollTimer = setTimeout(poll, POLL_EVERY_MS);
    }
  });
}

function redeem(code, current) {
  sendStatus(STATUS.CONNECTING);
  request(
    'POST',
    HUB + '/oauth/token',
    {
      form: {
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: REDIRECT,
        client_id: current.clientId,
        code_verifier: current.verifier,
        resource: RESOURCE,
      },
    },
    function (status, data) {
      if (status === 200 && data && data.access_token) {
        storeTokens(data);
        save({ client_used: 1 });
        fetchPlan();
      } else {
        startPairing();
      }
    }
  );
}

function unpair() {
  var token = load('refresh_token');
  if (token) {
    request('POST', HUB + '/oauth/revoke', { form: { token: token, client_id: load('client_id') } }, function () {});
  }
  signOut();
  startPairing();
}

/* ---------- events ---------- */

Pebble.addEventListener('ready', function () {
  fetchPlan();
  setInterval(function () {
    if (signedIn()) fetchPlan();
  }, REFRESH_EVERY_MS);
});

Pebble.addEventListener('appmessage', function (event) {
  var payload = event.payload || {};
  if (payload.Unpair) unpair();
  else if (payload.Refresh) {
    if (signedIn()) fetchPlan();
    else startPairing();
  }
});
