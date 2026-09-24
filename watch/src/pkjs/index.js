// today — the phone half of the watch app.
//
// Signs in to lost.plus once through a QR code shown on the watch, then
// fetches your plan from today.lost.plus and hands it to the watch.
//
// Pairing is the hub's device login, the same one the setup CLI uses:
//   1. POST /api/device naming today → a device code and an approval link
//   2. the watch shows the link as a QR; you scan it and approve on the hub
//   3. poll POST /api/device/token until you have, which returns a device
//      session and a first access token
// The session never rotates, so a watch reboot that kills a request halfway
// loses nothing. It lives in this app's localStorage and buys one-hour access
// tokens bound to today.lost.plus with scope `today`: your plan and nothing
// else.

var qrcode = require('qrcode-generator');

var BASE = 'https://today.lost.plus';
var HUB = 'https://auth.lost.plus';
var RESOURCE = BASE + '/mcp';
var REFRESH_EVERY_MS = 5 * 60 * 1000;

// In step with the STATUS_* values in src/c/today.c.
var STATUS = { OK: 0, CONNECTING: 1, PAIRING: 2, OFFLINE: 3 };

var pairing = null; // { code, interval }
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
  return !!load('session');
}

function signOut() {
  save({ access_token: null, session: null, access_expires: null });
}

// Before device login the watch held an OAuth refresh token and client.
save({ refresh_token: null, client_id: null, client_created: null, client_used: null });

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

function storeAccess(data) {
  save({
    access_token: data.access_token,
    access_expires: Date.now() + (data.expires_in || 3600) * 1000,
  });
}

function refreshTokens(done) {
  request(
    'POST',
    HUB + '/api/device/session/token',
    { json: { refresh_token: load('session') } },
    function (status, data) {
      if (status === 200 && data && data.access_token) {
        storeAccess(data);
        done('ok');
      } else if (status === 401) {
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

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  pairing = null;
}

function startPairing() {
  stopPolling();
  sendStatus(STATUS.CONNECTING);
  request(
    'POST',
    HUB + '/api/device',
    { form: { client: 'device', device_name: 'pebble', resource: RESOURCE } },
    function (status, data) {
      if (status !== 200 || !data || !data.device_code) return sendStatus(STATUS.OFFLINE);
      pairing = { code: data.device_code, interval: Math.max(data.interval || 5, 5) * 1000 };
      sendQr(data.verification_uri_complete);
      pollTimer = setTimeout(poll, pairing.interval);
    }
  );
}

function poll() {
  var current = pairing;
  if (!current) return;
  request('POST', HUB + '/api/device/token', { form: { device_code: current.code } }, function (status, data) {
    if (pairing !== current) return;
    var error = data && data.error;
    if (status === 200 && data && data.session) {
      stopPolling();
      save({ session: data.session.refresh_token });
      storeAccess(data);
      fetchPlan();
    } else if (status === 0 || status >= 500 || error === 'authorization_pending' || error === 'slow_down') {
      pollTimer = setTimeout(poll, current.interval);
    } else {
      startPairing(); // the code on screen expired or was refused; show a fresh one
    }
  });
}

function unpair() {
  var session = load('session');
  if (session) {
    request('POST', HUB + '/api/device/session/revoke', { json: { refresh_token: session } }, function () {});
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
