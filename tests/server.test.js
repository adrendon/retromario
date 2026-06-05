/* =========================================================
   Tests de integración — sin dependencias (node:test).
   Levanta server.js en un puerto efímero y golpea la API real.
   ========================================================= */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const { server, resetState } = require('../server.js');

let port;

test.before(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.after(() => {
  server.close();
});

test.beforeEach(() => resetState());

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? '' : JSON.stringify(body);
    const req = http.request({
      method,
      hostname: '127.0.0.1',
      port,
      path,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers
      }
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        let parsed = null;
        try { parsed = buf ? JSON.parse(buf) : null; } catch {}
        resolve({ status: res.statusCode, body: parsed, raw: buf });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Abre /api/stream, espera el evento 'hello' y cierra. Devuelve el clientId.
function openStreamHello(clientId) {
  return new Promise((resolve, reject) => {
    const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
    const req = http.request({
      method: 'GET',
      hostname: '127.0.0.1',
      port,
      path: `/api/stream${qs}`,
      headers: { Accept: 'text/event-stream' }
    }, res => {
      let buf = '';
      res.on('data', chunk => {
        buf += chunk.toString();
        const idx = buf.indexOf('\n\n');
        if (idx === -1) return;
        const frame = buf.slice(0, idx);
        const lines = frame.split('\n');
        const ev = lines.find(l => l.startsWith('event: '));
        const data = lines.find(l => l.startsWith('data: '));
        if (ev && ev.includes('hello') && data) {
          let payload = null;
          try { payload = JSON.parse(data.slice(6)); } catch {}
          res.destroy();
          req.destroy();
          resolve(payload);
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET /api/state inicia con boardActive=false y sin tarjetas', async () => {
  const r = await request('GET', '/api/state');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.boardActive, false);
  assert.deepStrictEqual(r.body.cards['banana-past'], []);
  assert.strictEqual(r.body.adminTaken, false);
});

test('GET /api/health responde ok y no expone secretos', async () => {
  const r = await request('GET', '/api/health');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(typeof r.body.uptimeSec, 'number');
  assert.strictEqual(r.body.adminTaken, false);
  assert.strictEqual(r.body.boardActive, false);
  // No deben filtrarse claves sensibles.
  assert.strictEqual(r.body.adminPin, undefined);
  assert.strictEqual(r.body.adminToken, undefined);
});

test('GET /api/stream devuelve hello con el clientId solicitado', async () => {
  const cid = 'test-client-1234abcd';
  const hello = await openStreamHello(cid);
  assert.strictEqual(hello.clientId, cid);
});

test('POST /api/pilots registra dos pilotos y aparecen en /api/state', async () => {
  const cid1 = 'pilot-aaa-11112222';
  const cid2 = 'pilot-bbb-33334444';
  await openStreamHello(cid1);
  await openStreamHello(cid2);
  await request('POST', '/api/pilots', { clientId: cid1, name: 'Ana', character: '🍄' });
  await request('POST', '/api/pilots', { clientId: cid2, name: 'Beto', character: '🦖' });

  const state = await request('GET', '/api/state');
  const names = state.body.pilots.map(p => p.name).sort();
  assert.deepStrictEqual(names, ['Ana', 'Beto']);
});

test('POST /api/admin/claim devuelve adminToken con PIN correcto', async () => {
  const cid = 'admin-cli-55556666';
  await openStreamHello(cid);
  const r = await request('POST', '/api/admin/claim', { clientId: cid, pin: 'sitioBanco' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.isAdmin, true);
  assert.strictEqual(typeof r.body.adminToken, 'string');
  assert.ok(r.body.adminToken.length > 10);
});

test('POST /api/admin/claim falla con PIN incorrecto', async () => {
  const cid = 'admin-cli-77778888';
  await openStreamHello(cid);
  const r = await request('POST', '/api/admin/claim', { clientId: cid, pin: 'incorrecto' });
  assert.strictEqual(r.status, 403);
});

test('POST /api/admin/restore restaura admin con clientId + token válidos', async () => {
  // El flujo real de restore es: la pestaña se recargó, el SSE se reabrió con
  // el mismo clientId, y queremos volver a entrar como admin sin re-pedir PIN.
  // (Si el usuario pulsa "Salir admin", los tokens se revocan a propósito.)
  const cid = 'admin-restore-99990000';
  await openStreamHello(cid);
  const claim = await request('POST', '/api/admin/claim', { clientId: cid, pin: 'sitioBanco' });
  const token = claim.body.adminToken;

  const r = await request('POST', '/api/admin/restore', { clientId: cid, adminToken: token });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.isAdmin, true);
});

test('release revoca el token: restore posterior devuelve 403', async () => {
  const cid = 'admin-release-aabbccdd';
  await openStreamHello(cid);
  const claim = await request('POST', '/api/admin/claim', { clientId: cid, pin: 'sitioBanco' });
  const token = claim.body.adminToken;

  await request('POST', '/api/admin/release', { clientId: cid });
  const r = await request('POST', '/api/admin/restore', { clientId: cid, adminToken: token });
  assert.strictEqual(r.status, 403);
});

test('Endpoint admin sin credenciales devuelve 403', async () => {
  const r = await request('POST', '/api/board', { active: true });
  assert.strictEqual(r.status, 403);
});

test('Admin válido puede activar el tablero', async () => {
  const cid = 'admin-board-aabbccdd';
  await openStreamHello(cid);
  await request('POST', '/api/admin/claim', { clientId: cid, pin: 'sitioBanco' });

  const r = await request('POST', '/api/board', { clientId: cid, active: true });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.boardActive, true);

  const state = await request('GET', '/api/state');
  assert.strictEqual(state.body.boardActive, true);
});

test('Cronómetro: start/pause/reset por admin', async () => {
  const cid = 'admin-timer-eeff0011';
  await openStreamHello(cid);
  await request('POST', '/api/admin/claim', { clientId: cid, pin: 'sitioBanco' });

  let r = await request('POST', '/api/timer', { clientId: cid, action: 'start', durationSec: 180 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.running, true);
  assert.strictEqual(r.body.durationSec, 180);

  r = await request('POST', '/api/timer', { clientId: cid, action: 'pause' });
  assert.strictEqual(r.body.running, false);

  r = await request('POST', '/api/timer', { clientId: cid, action: 'reset' });
  assert.strictEqual(r.body.running, false);
  assert.strictEqual(r.body.startedAt, 0);
});

test('POST /api/cards rechaza con tablero inactivo (409)', async () => {
  const cid = 'pilot-card-22334455';
  await openStreamHello(cid);
  await request('POST', '/api/pilots', { clientId: cid, name: 'Cata', character: '🍄' });

  const r = await request('POST', '/api/cards', { clientId: cid, cat: 'banana-past', text: 'algo' });
  assert.strictEqual(r.status, 409);
});

test('POST /api/cards usa el autor real del piloto (no confía en body.author)', async () => {
  const adminCid = 'admin-cards-66778899';
  const pilotCid = 'pilot-cards-aabbccdd';
  await openStreamHello(adminCid);
  await openStreamHello(pilotCid);
  await request('POST', '/api/admin/claim', { clientId: adminCid, pin: 'sitioBanco' });
  await request('POST', '/api/board', { clientId: adminCid, active: true });
  await request('POST', '/api/pilots', { clientId: pilotCid, name: 'Dani', character: '🦖' });

  // Intenta firmar como otro autor: el server debe ignorarlo y usar el pilot real.
  const r = await request('POST', '/api/cards', {
    clientId: pilotCid,
    cat: 'banana-past',
    text: 'tarjeta falsificada',
    author: 'HACKER',
    character: '👻'
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.author, 'Dani');
  assert.strictEqual(r.body.character, '🦖');
});
