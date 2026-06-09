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


test('Admin puede guardar objetivo sin perder pasos', async () => {
  const cid = 'admin-objective-11223344';
  await openStreamHello(cid);
  await request('POST', '/api/admin/claim', { clientId: cid, pin: 'sitioBanco' });
  await request('POST', '/api/steps', { clientId: cid, steps: [0, 1] });

  const r = await request('POST', '/api/objective', { clientId: cid, text: 'Mejorar foco del sprint' });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.text, 'Mejorar foco del sprint');

  const state = await request('GET', '/api/state');
  assert.deepStrictEqual(state.body.steps, [0, 1]);
  assert.strictEqual(state.body.objective, 'Mejorar foco del sprint');
});

test('POST /api/objective rechaza sin credenciales admin', async () => {
  const r = await request('POST', '/api/objective', { text: 'no autorizado' });
  assert.strictEqual(r.status, 403);
});

test('POST /api/cards rechaza cuando terminó el tiempo del tablero', async () => {
  const adminCid = 'admin-expired-aabb1100';
  const pilotCid = 'pilot-expired-ccdd2200';
  await openStreamHello(adminCid);
  await openStreamHello(pilotCid);
  await request('POST', '/api/admin/claim', { clientId: adminCid, pin: 'sitioBanco' });
  await request('POST', '/api/board', { clientId: adminCid, active: true });
  await request('POST', '/api/pilots', { clientId: pilotCid, name: 'Eva', character: '🍄' });
  const started = await request('POST', '/api/timer', { clientId: adminCid, action: 'start', durationSec: 10 });
  assert.strictEqual(started.status, 200);

  const realNow = Date.now;
  Date.now = () => started.body.startedAt + 11_000;
  try {
    const r = await request('POST', '/api/cards', { clientId: pilotCid, cat: 'banana-past', text: 'fuera de tiempo' });
    assert.strictEqual(r.status, 409);
    assert.match(r.body.error, /tiempo/i);
  } finally {
    Date.now = realNow;
  }
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


test('POST /api/cards/:cat/:id/like rechaza sin tablero activo (409)', async () => {
  const adminCid = 'admin-like-aaaa1111';
  const pilotCid = 'pilot-like-bbbb2222';
  await openStreamHello(adminCid);
  await openStreamHello(pilotCid);
  await request('POST', '/api/admin/claim', { clientId: adminCid, pin: 'sitioBanco' });
  await request('POST', '/api/board', { clientId: adminCid, active: true });
  await request('POST', '/api/pilots', { clientId: pilotCid, name: 'Lía', character: '🍓' });
  const created = await request('POST', '/api/cards', { clientId: pilotCid, cat: 'banana-past', text: 'a corregir' });
  assert.strictEqual(created.status, 201);
  const cardId = created.body.id;

  // Desactiva el tablero y prueba like → debe dar 409
  await request('POST', '/api/board', { clientId: adminCid, active: false });
  const r = await request('POST', '/api/cards/banana-past/' + cardId + '/like', { clientId: pilotCid });
  assert.strictEqual(r.status, 409);
});

test('POST /api/cards/:cat/:id/like es idempotente toggle y devuelve likedBy', async () => {
  const adminCid = 'admin-like-cccc3333';
  const p1 = 'pilot-like-dddd4444';
  const p2 = 'pilot-like-eeee5555';
  await openStreamHello(adminCid);
  await openStreamHello(p1);
  await openStreamHello(p2);
  await request('POST', '/api/admin/claim', { clientId: adminCid, pin: 'sitioBanco' });
  await request('POST', '/api/board', { clientId: adminCid, active: true });
  await request('POST', '/api/pilots', { clientId: p1, name: 'Ana', character: '🍄' });
  await request('POST', '/api/pilots', { clientId: p2, name: 'Bob', character: '🐢' });

  // p1 (Ana) crea la tarjeta
  const created = await request('POST', '/api/cards', { clientId: p1, cat: 'power-future', text: 'gran demo' });
  const cid = created.body.id;

  // p1 (autora) intenta darse like → debe rechazar 409
  let r = await request('POST', '/api/cards/power-future/' + cid + '/like', { clientId: p1 });
  assert.strictEqual(r.status, 409, 'el autor no puede darse like a su propia tarjeta');

  // p2 da like → 1
  r = await request('POST', '/api/cards/power-future/' + cid + '/like', { clientId: p2 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.liked, true);
  assert.strictEqual(r.body.likeCount, 1);
  assert.deepStrictEqual(r.body.likedBy, [{ name: 'Bob', character: '🐢' }]);

  // p2 toggle off → 0
  r = await request('POST', '/api/cards/power-future/' + cid + '/like', { clientId: p2 });
  assert.strictEqual(r.body.liked, false);
  assert.strictEqual(r.body.likeCount, 0);
  assert.deepStrictEqual(r.body.likedBy, []);

  // p2 like de nuevo → 1
  r = await request('POST', '/api/cards/power-future/' + cid + '/like', { clientId: p2 });
  assert.strictEqual(r.body.likeCount, 1);

  // state expone likeCount/likedBy y no los clientId crudos
  const state = await request('GET', '/api/state');
  const card = state.body.cards['power-future'].find(c => c.id === cid);
  assert.strictEqual(card.likeCount, 1);
  assert.strictEqual(card.likedBy.length, 1);
  assert.strictEqual(card.likes, undefined, 'no debe exponerse el objeto interno de likes');
});

test('POST /api/cards/:cat/:id/like rechaza si no eres piloto (400)', async () => {
  const adminCid = 'admin-like-ffff6666';
  const stranger = 'stranger-7777-8888';
  await openStreamHello(adminCid);
  await openStreamHello(stranger);
  await request('POST', '/api/admin/claim', { clientId: adminCid, pin: 'sitioBanco' });
  await request('POST', '/api/board', { clientId: adminCid, active: true });

  const pid = 'pilot-like-9999aaaa';
  await openStreamHello(pid);
  await request('POST', '/api/pilots', { clientId: pid, name: 'Caro', character: '🍒' });
  const created = await request('POST', '/api/cards', { clientId: pid, cat: 'shortcut-future', text: 'mejora' });
  const cid = created.body.id;

  const r = await request('POST', '/api/cards/shortcut-future/' + cid + '/like', { clientId: stranger });
  assert.strictEqual(r.status, 400);
});

