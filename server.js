/* =========================================================
   🏁 Retro Mario Kart — Servidor (Node.js, sin dependencias)
   =========================================================
   - Sirve los estáticos (index.html, styles.css, app.js)
   - REST API para tarjetas, pilotos y pasos
   - SSE (/api/stream) en tiempo real
   - Estado en memoria; persistencia opcional por archivo si se define
     MARIO_DATA_FILE (ver docs/pr-03-server-file-persistence.md).
   Run:  node server.js   (o  npm start)
   ========================================================= */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT      = Number(process.env.PORT) || 3000;
const HOST      = process.env.HOST || '0.0.0.0';
const ROOT      = __dirname;
const ADMIN_PIN = String(process.env.MARIO_ADMIN_PIN || 'sitioBanco');
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h: sobrevive recargas, no reinicios del server
const DATA_FILE = process.env.MARIO_DATA_FILE || null;

const CATEGORIES = [
  'banana-future','shortcut-future','power-future',
  'shortcut-past','banana-past','power-past'
];

/* ---------- Logs estructurados ---------- */
// Una línea JSON por evento. No incluir PIN, tokens ni contenido sensible.
function logEvent(event, fields) {
  try {
    console.log(JSON.stringify({ event, ts: new Date().toISOString(), ...(fields || {}) }));
  } catch {
    console.log(event);
  }
}

/* ---------- Estado ---------- */
function emptyData() {
  const cards = {};
  CATEGORIES.forEach(c => cards[c] = []);
  return {
    cards, steps: [], objective: '', actions: [],
    sprint: '245',
    boardActive: false,
    timer: { durationSec: 5 * 60, startedAt: 0, elapsedAtPause: 0, running: false }
  };
}

let data = emptyData();

// Admin actual (clientId). Solo uno a la vez. Memoria.
let adminClientId = null;
// Sesiones admin por token para que recargar la página no obligue a poner el PIN otra vez.
// Map<token, { clientId, createdAt }>
const adminSessions = new Map();

// Pilotos en vivo: solo memoria (se vacían al reiniciar y al desconectar)
// Map<clientId, { name, character, joinedAt }>
const livePilots = new Map();

// Pilotos que en algún momento de esta sesión entraron al server (aunque hayan salido).
// Sirve para el Excel: queremos listar a TODOS los que participaron.
// Map<name.toLowerCase(), { name, character }>
const everPilots = new Map();

// Moods del rompehielo: solo memoria. Map<clientId, { emoji, label, name, character }>
const moods = new Map();

const MAX_ACTIONS = 5;
function moodsList() { return [...moods.values()]; }

/* ---------- Estado de la mini-carrera (basada en tarjetas) ----------
   Reglas:
   - Posición del kart  = (número de columnas distintas en las que el piloto
     ha escrito al menos una tarjeta) / 6
   - Tarjetas totales   = cuenta total escritas por ese piloto
   - Ganador            = primero en llegar a 6 columnas distintas.
     Empate → desempata por total de tarjetas (más = mejor).
   El estado se recalcula en cada cambio del tablero / lista de pilotos.
*/
const RACE_TARGET = CATEGORIES.length; // 6

function computeRace() {
  const byPilot = new Map(); // key=name.toLowerCase()
  // Asegura que aparezcan los pilotos aunque no hayan escrito nada
  for (const p of getPilotsList()) {
    byPilot.set(p.name.toLowerCase(), {
      name: p.name,
      character: p.character,
      cols: new Set(),
      cards: 0,
      firstAt: 0,
      finishedAt: 0
    });
  }
  for (const cat of CATEGORIES) {
    for (const card of data.cards[cat] || []) {
      const author = (card.author || '').toLowerCase();
      if (!author) continue;
      let entry = byPilot.get(author);
      if (!entry) {
        // Piloto que escribió tarjetas pero ya no está conectado:
        // lo añadimos igualmente para que siga apareciendo en el podio.
        entry = {
          name: card.author,
          character: card.character || '🍄',
          cols: new Set(),
          cards: 0,
          firstAt: 0,
          finishedAt: 0
        };
        byPilot.set(author, entry);
      }
      entry.cards += 1;
      if (!entry.cols.has(cat)) entry.cols.add(cat);
      if (!entry.firstAt || card.ts < entry.firstAt) entry.firstAt = card.ts;
      if (entry.cols.size === RACE_TARGET && !entry.finishedAt) {
        entry.finishedAt = card.ts || Date.now();
      }
    }
  }
  const standings = [...byPilot.values()].map(e => ({
    name: e.name,
    character: e.character,
    columns: e.cols.size,
    cards: e.cards,
    progress: Math.round((e.cols.size / RACE_TARGET) * 100),
    finished: e.cols.size >= RACE_TARGET,
    finishedAt: e.finishedAt
  }));
  standings.sort((a, b) => {
    if (a.finished && b.finished) return a.finishedAt - b.finishedAt;
    if (a.finished) return -1;
    if (b.finished) return 1;
    if (b.columns !== a.columns) return b.columns - a.columns;
    return b.cards - a.cards;
  });
  // Lista de todos los que terminaron (en orden de llegada) para el podio multi
  const finishers = standings.filter(s => s.finished);
  const winner = finishers[0] || null;
  return { target: RACE_TARGET, standings, winner, finishers };
}

function racePublicState() { return computeRace(); }

function broadcastRace() { broadcast('race:update', racePublicState()); }

/* ---------- Persistencia opcional (MARIO_DATA_FILE) ---------- */
let saveTimer = null;
let savePending = false;

function loadData() {
  if (!DATA_FILE) return;
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    if (parsed.cards && typeof parsed.cards === 'object') {
      for (const c of CATEGORIES) {
        if (Array.isArray(parsed.cards[c])) data.cards[c] = parsed.cards[c];
      }
    }
    if (Array.isArray(parsed.steps)) data.steps = parsed.steps.filter(n => Number.isInteger(n) && n >= 0 && n < 50);
    if (typeof parsed.objective === 'string') data.objective = String(parsed.objective).slice(0, 800);
    if (Array.isArray(parsed.actions)) data.actions = parsed.actions;
    if (typeof parsed.sprint === 'string') data.sprint = String(parsed.sprint).slice(0, 16);
    if (typeof parsed.boardActive === 'boolean') data.boardActive = parsed.boardActive;
    if (parsed.timer && typeof parsed.timer === 'object') {
      data.timer = {
        durationSec: Math.max(10, Math.min(60 * 60, Number(parsed.timer.durationSec) || 300)),
        startedAt: Number(parsed.timer.startedAt) || 0,
        elapsedAtPause: Number(parsed.timer.elapsedAtPause) || 0,
        running: !!parsed.timer.running
      };
    }
    if (parsed.everPilots && typeof parsed.everPilots === 'object') {
      for (const [k, v] of Object.entries(parsed.everPilots)) {
        if (v && typeof v === 'object' && v.name) {
          everPilots.set(String(k), {
            name: String(v.name).slice(0, 32),
            character: String(v.character || '🍄').slice(0, 8)
          });
        }
      }
    }
    logEvent('state_loaded', { file: DATA_FILE });
  } catch (err) {
    logEvent('state_load_failed', { error: err && err.message });
  }
}

function writeDataFileSync() {
  if (!DATA_FILE) return;
  savePending = false;
  const snapshot = {
    cards: data.cards,
    steps: data.steps,
    objective: data.objective,
    actions: data.actions,
    sprint: data.sprint,
    boardActive: data.boardActive,
    timer: data.timer,
    everPilots: Object.fromEntries(everPilots)
  };
  const tmp = DATA_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(snapshot));
    fs.renameSync(tmp, DATA_FILE);
  } catch (err) {
    logEvent('state_save_failed', { error: err && err.message });
  }
}

// Debounced: muchas mutaciones seguidas → un solo write. Útil en SSE broadcasts.
function saveData() {
  if (!DATA_FILE) return;
  savePending = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (savePending) writeDataFileSync();
  }, 100);
}

function saveDataSync() {
  if (!DATA_FILE) return;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (savePending) writeDataFileSync();
}

/* ---------- resetState (para tests; también útil tras /api/clear total) ---------- */
function resetState() {
  data = emptyData();
  adminClientId = null;
  adminSessions.clear();
  livePilots.clear();
  everPilots.clear();
  moods.clear();
  for (const res of clients.values()) { try { res.end(); } catch {} }
  clients.clear();
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  savePending = false;
}

function getPilotsList() {
  // Participantes registrados durante esta sesión del server. No los quitamos al desconectar
  // porque en Render/proxies una reconexión breve no debe hacer desaparecer usuarios ya creados.
  return [...everPilots.values()];
}

function getAllPilotsList() {
  // Alias explícito para reportes/Excel: todos los pilotos registrados en la sesión.
  return getPilotsList();
}

/* ---------- SSE ---------- */
// Map<clientId, res>
const clients = new Map();

function broadcast(event, payload) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients.values()) {
    try { res.write(msg); } catch { /* cliente caído */ }
  }
}

/* ---------- Utilidades HTTP ---------- */
function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body == null ? '' : JSON.stringify(body));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8'
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '' || rel === '/admin' || rel === '/admin/') rel = '/index.html';
  const safe = path.normalize(rel).replace(/^([\\/])+/, '');
  const full = path.join(ROOT, safe);
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  const base = path.basename(full);
  if (base === 'server.js' || base === 'package.json') {
    res.writeHead(404); return res.end('Not found');
  }

  fs.stat(full, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(full).pipe(res);
  });
}

/* ---------- Handlers de API ---------- */
function makeId() { return crypto.randomUUID(); }
function makeAdminToken() { return crypto.randomBytes(32).toString('base64url'); }
function sanitize(str, max) { return String(str == null ? '' : str).slice(0, max); }
function normalizeClientId(value) {
  const id = sanitize(value, 80).trim();
  // Permitimos ids UUID/crypto del navegador y evitamos saltos de línea en SSE/logs.
  return /^[A-Za-z0-9_-]{8,80}$/.test(id) ? id : '';
}


function pruneAdminSessions(now = Date.now()) {
  for (const [token, session] of adminSessions) {
    if (!session || now - session.createdAt > ADMIN_SESSION_TTL_MS) adminSessions.delete(token);
  }
}

function createAdminSession(clientId) {
  pruneAdminSessions();
  const token = makeAdminToken();
  adminSessions.set(token, { clientId, createdAt: Date.now() });
  return token;
}

function validateAdminSession(clientId, token) {
  pruneAdminSessions();
  const session = adminSessions.get(sanitize(token, 128));
  return !!(session && session.clientId === clientId);
}

function revokeAdminSessions(clientId) {
  for (const [token, session] of adminSessions) {
    if (session && session.clientId === clientId) adminSessions.delete(token);
  }
}

function publicActions() {
  // Convertir votes object → array de claves (clientIds) para el cliente.
  // El cliente sólo necesita saber si su clientId está incluido y el total.
  return data.actions.map(a => {
    const votesObj = a.votes || {};
    return {
      id: a.id,
      text: a.text,
      author: a.author,
      character: a.character,
      ts: a.ts,
      voters: Object.keys(votesObj),
      voterNames: Object.values(votesObj).map(v => ({
        name: v && v.name ? v.name : '',
        character: v && v.character ? v.character : ''
      })),
      voteCount: Object.keys(votesObj).length
    };
  });
}

// Devuelve las tarjetas con `likedBy` (array de {name,character}) en lugar de
// exponer los clientId del objeto interno `likes`.
function publicCard(card) {
  const likesObj = (card && card.likes) || {};
  return {
    id: card.id,
    text: card.text,
    author: card.author,
    character: card.character,
    ts: card.ts,
    likeCount: Object.keys(likesObj).length,
    likedBy: Object.values(likesObj).map(v => ({
      name: v && v.name ? v.name : '',
      character: v && v.character ? v.character : ''
    }))
  };
}
function publicCards() {
  const out = {};
  for (const cat of CATEGORIES) {
    out[cat] = (data.cards[cat] || []).map(publicCard);
  }
  return out;
}

function fullState() {
  return {
    cards: publicCards(),
    pilots: getPilotsList(),
    allPilots: getAllPilotsList(),
    steps: data.steps,
    race: racePublicState(),
    objective: data.objective || '',
    moods: moodsList(),
    actions: publicActions(),
    sprint: data.sprint || '',
    boardActive: !!data.boardActive,
    timer: timerPublic(),
    adminTaken: !!adminClientId
  };
}

function timerPublic() {
  return {
    durationSec: data.timer.durationSec,
    startedAt: data.timer.startedAt,
    elapsedAtPause: data.timer.elapsedAtPause,
    running: data.timer.running,
    serverNow: Date.now()
  };
}

function broadcastSprint() { broadcast('sprint:update', { sprint: data.sprint }); }
function broadcastBoard()  { broadcast('board:update',  { boardActive: !!data.boardActive }); }
function broadcastTimer()  { broadcast('timer:update',  timerPublic()); }
function broadcastAdmin()  { broadcast('admin:update',  { adminTaken: !!adminClientId }); }

function requireAdmin(req, body) {
  const cid = normalizeClientId((body && body.clientId) || req.headers['x-client-id'] || '');
  const token = sanitize((body && body.adminToken) || req.headers['x-admin-token'] || '', 128);
  if (!cid) return false;
  if (cid === adminClientId) return true;
  if (validateAdminSession(cid, token) && (!adminClientId || adminClientId === cid)) {
    const wasTaken = !!adminClientId;
    adminClientId = cid;
    if (!wasTaken) {
      logEvent('admin_restored', { auto: true });
      broadcastAdmin();
    }
    return true;
  }
  return false;
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

  // GET /api/state
  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'state') {
    return send(res, 200, fullState());
  }

  // GET /api/health  (observabilidad — sin secretos)
  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'health') {
    const totalCards = CATEGORIES.reduce((n, c) => n + ((data.cards[c] || []).length), 0);
    return send(res, 200, {
      ok: true,
      uptimeSec: Math.round(process.uptime()),
      serverNow: Date.now(),
      clientsConnected: clients.size,
      pilotsRegistered: everPilots.size,
      livePilots: livePilots.size,
      adminTaken: !!adminClientId,
      boardActive: !!data.boardActive,
      timerRunning: !!data.timer.running,
      cards: totalCards,
      actions: data.actions.length,
      persistence: DATA_FILE ? 'file' : 'memory'
    });
  }

  // GET /api/stream  (SSE)
  if (req.method === 'GET' && parts.length === 2 && parts[1] === 'stream') {
    const requestedId = normalizeClientId(url.searchParams.get('clientId'));
    const clientId = requestedId || makeId();
    const previous = clients.get(clientId);
    if (previous) {
      try { previous.end(); } catch {}
      clients.delete(clientId);
      logEvent('sse_replaced', { clientId });
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    // Mensaje inicial: id de cliente + snapshot completo
    res.write(`event: hello\ndata: ${JSON.stringify({ clientId })}\n\n`);
    res.write(`event: snapshot\ndata: ${JSON.stringify(fullState())}\n\n`);
    clients.set(clientId, res);
    logEvent('sse_connected', { clientId, clients: clients.size });

    const ka = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 25000);

    const cleanup = () => {
      clearInterval(ka);
      if (clients.get(clientId) !== res) return;
      clients.delete(clientId);
      const removed = livePilots.get(clientId);
      livePilots.delete(clientId);
      if (moods.delete(clientId)) broadcast('moods:update', moodsList());
      if (adminClientId === clientId) {
        // En una recarga normal el EventSource viejo cierra antes de abrir el nuevo.
        // Damos una ventana corta para no expulsar al admin ni pedir PIN de nuevo.
        setTimeout(() => {
          if (adminClientId === clientId && !clients.has(clientId)) {
            adminClientId = null;
            broadcastAdmin();
            logEvent('admin_released', { reason: 'sse_timeout' });
          }
        }, 10000);
      }
      logEvent('sse_disconnected', { clientId, clients: clients.size });
      if (removed) {
        const stillThere = [...livePilots.values()]
          .some(p => p.name.toLowerCase() === removed.name.toLowerCase());
        if (!stillThere) {
          broadcast('pilots:update', { pilots: getPilotsList(), allPilots: getAllPilotsList() });
          broadcastRace();
          console.log(`👋 ${removed.character} ${removed.name} se desconectó (sigue en participantes)`);
        }
      }
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
    return;
  }

  // POST /api/cards    body: { cat, text }   (autor lo decide el server según clientId)
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'cards') {
    const body = await readBody(req);
    if (!data.boardActive) return send(res, 409, { error: 'El tablero no está activo' });
    const cat = String(body.cat || '');
    if (!CATEGORIES.includes(cat)) return send(res, 400, { error: 'Categoría inválida' });
    const text = sanitize(body.text, 200).trim();
    if (!text) return send(res, 400, { error: 'Texto vacío' });
    // Toma el autor real desde livePilots (no se confía en lo que envía el cliente).
    const cid = normalizeClientId(body.clientId || req.headers['x-client-id'] || '');
    const pilot = cid ? livePilots.get(cid) : null;
    if (!pilot) return send(res, 400, { error: 'Únete antes de escribir tarjetas' });
    const card = {
      id: makeId(),
      text,
      author: pilot.name,
      character: pilot.character || '🍄',
      ts: Date.now(),
      likes: {}
    };
    data.cards[cat].push(card);
    saveData();
    broadcast('card:add', { cat, card: publicCard(card) });
    broadcastRace();
    return send(res, 201, publicCard(card));
  }

  // DELETE /api/cards/:cat/:id
  if (req.method === 'DELETE' && parts.length === 4 && parts[1] === 'cards') {
    const cat = parts[2];
    const id  = parts[3];
    if (!CATEGORIES.includes(cat)) return send(res, 404, { error: 'Categoría' });
    const before = data.cards[cat].length;
    data.cards[cat] = data.cards[cat].filter(c => c.id !== id);
    if (data.cards[cat].length === before) return send(res, 404, { error: 'No encontrada' });
    saveData();
    broadcast('card:remove', { cat, id });
    broadcastRace();
    return send(res, 204);
  }

  // POST /api/cards/:cat/:id/like   body: { clientId }   (toggle)
  if (req.method === 'POST' && parts.length === 5 && parts[1] === 'cards' && parts[4] === 'like') {
    const cat = parts[2];
    const id  = parts[3];
    if (!CATEGORIES.includes(cat)) return send(res, 404, { error: 'Categoría' });
    if (!data.boardActive) return send(res, 409, { error: 'El tablero no está activo' });
    const body = await readBody(req);
    const cid = normalizeClientId(body.clientId || req.headers['x-client-id'] || '');
    const pilot = cid ? livePilots.get(cid) : null;
    if (!pilot) return send(res, 400, { error: 'Únete antes de dar me gusta' });
    const card = (data.cards[cat] || []).find(c => c.id === id);
    if (!card) return send(res, 404, { error: 'No encontrada' });
    if (!card.likes) card.likes = {};
    if (card.likes[cid]) delete card.likes[cid];
    else card.likes[cid] = { name: pilot.name, character: pilot.character || '🍄', ts: Date.now() };
    saveData();
    const pub = publicCard(card);
    broadcast('card:like', { cat, id, likeCount: pub.likeCount, likedBy: pub.likedBy });
    return send(res, 200, { id, liked: !!card.likes[cid], likeCount: pub.likeCount, likedBy: pub.likedBy });
  }

  // POST /api/clear  (admin)
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'clear') {
    const body = await readBody(req);
    if (!requireAdmin(req, body)) return send(res, 403, { error: 'Solo el admin puede borrar el tablero' });
    CATEGORIES.forEach(c => data.cards[c] = []);
    saveData();
    broadcast('board:clear', {});
    broadcastRace();
    logEvent('state_cleared', {});
    return send(res, 200, { ok: true });
  }

  // POST /api/pilots  body: { clientId, name, character }
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'pilots') {
    const body = await readBody(req);
    const clientId = normalizeClientId(body.clientId);
    const name = sanitize(body.name, 32).trim();
    const character = sanitize(body.character, 8) || '🍄';
    if (!name)     return send(res, 400, { error: 'Nombre requerido' });
    if (!clientId) return send(res, 400, { error: 'clientId requerido (conéctate al stream primero)' });

    // Limpia mismas conexiones con otro nombre (cambió de piloto en esta misma pestaña)
    livePilots.set(clientId, { name, character, joinedAt: Date.now() });
    everPilots.set(name.toLowerCase(), { name, character });
    logEvent('pilot_registered', { clientId, name, character });
    broadcast('pilots:update', { pilots: getPilotsList(), allPilots: getAllPilotsList() });
    broadcastRace();
    return send(res, 200, { pilots: getPilotsList(), allPilots: getAllPilotsList() });
  }

  // POST /api/steps  body: { clientId, steps: [indices] }  (admin)
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'steps') {
    const body = await readBody(req);
    if (!requireAdmin(req, body)) return send(res, 403, { error: 'Solo el admin puede marcar los pasos' });
    const list = Array.isArray(body.steps)
      ? body.steps.filter(n => Number.isInteger(n) && n >= 0 && n < 50)
      : [];
    data.steps = list;
    saveData();
    broadcast('steps:update', data.steps);
    return send(res, 200, { steps: data.steps });
  }

  // POST /api/objective  body: { text }
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'objective') {
    const body = await readBody(req);
    data.objective = sanitize(body.text, 800);
    saveData();
    broadcast('objective:update', { text: data.objective });
    return send(res, 200, { text: data.objective });
  }

  // POST /api/moods  body: { clientId, emoji, label }
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'moods') {
    const body = await readBody(req);
    const clientId = normalizeClientId(body.clientId);
    const pilot = livePilots.get(clientId);
    if (!pilot) return send(res, 400, { error: 'Únete antes de elegir tu ánimo' });
    const emoji = sanitize(body.emoji, 8);
    const label = sanitize(body.label, 32);
    if (!emoji) return send(res, 400, { error: 'Emoji requerido' });
    moods.set(clientId, { emoji, label, name: pilot.name, character: pilot.character });
    broadcast('moods:update', moodsList());
    return send(res, 200, { moods: moodsList() });
  }

  // DELETE /api/moods  body: { clientId }
  if (req.method === 'DELETE' && parts.length === 2 && parts[1] === 'moods') {
    const body = await readBody(req);
    const clientId = normalizeClientId(body.clientId);
    if (moods.delete(clientId)) broadcast('moods:update', moodsList());
    return send(res, 200, { ok: true });
  }

  // POST /api/actions  body: { clientId, text }  (admin)
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'actions') {
    const body = await readBody(req);
    if (!requireAdmin(req, body)) return send(res, 403, { error: 'Solo el admin puede añadir acciones' });
    const clientId = normalizeClientId(body.clientId);
    const pilot = livePilots.get(clientId) || { name: 'Admin', character: '👑' };
    if (data.actions.length >= MAX_ACTIONS) return send(res, 409, { error: `Máximo ${MAX_ACTIONS} acciones` });
    const text = sanitize(body.text, 240).trim();
    if (!text) return send(res, 400, { error: 'Texto vacío' });
    const action = {
      id: makeId(),
      text,
      author: pilot.name,
      character: pilot.character,
      ts: Date.now(),
      votes: {}
    };
    data.actions.push(action);
    saveData();
    broadcast('actions:update', publicActions());
    return send(res, 201, action);
  }

  // DELETE /api/actions/:id  (admin)
  if (req.method === 'DELETE' && parts.length === 3 && parts[1] === 'actions') {
    const body = await readBody(req);
    if (!requireAdmin(req, body)) return send(res, 403, { error: 'Solo el admin puede borrar acciones' });
    const id = parts[2];
    const before = data.actions.length;
    data.actions = data.actions.filter(a => a.id !== id);
    if (data.actions.length === before) return send(res, 404, { error: 'No encontrada' });
    saveData();
    broadcast('actions:update', publicActions());
    return send(res, 204);
  }

  // POST /api/actions/clear  (admin)
  if (req.method === 'POST' && parts.length === 3 && parts[1] === 'actions' && parts[2] === 'clear') {
    const body = await readBody(req);
    if (!requireAdmin(req, body)) return send(res, 403, { error: 'Solo el admin puede borrar las acciones' });
    data.actions = [];
    saveData();
    broadcast('actions:update', publicActions());
    return send(res, 200, { ok: true });
  }

  // POST /api/actions/:id/vote  body: { clientId }  (toggle)
  if (req.method === 'POST' && parts.length === 4 && parts[1] === 'actions' && parts[3] === 'vote') {
    const id = parts[2];
    const body = await readBody(req);
    const clientId = normalizeClientId(body.clientId);
    const pilot = livePilots.get(clientId);
    if (!pilot) return send(res, 400, { error: 'Únete antes de votar' });
    const action = data.actions.find(a => a.id === id);
    if (!action) return send(res, 404, { error: 'Acción no encontrada' });
    if (!action.votes) action.votes = {};
    if (action.votes[clientId]) delete action.votes[clientId];
    else action.votes[clientId] = { name: pilot.name, character: pilot.character, ts: Date.now() };
    saveData();
    broadcast('actions:update', publicActions());
    return send(res, 200, {
      id: action.id,
      voted: !!action.votes[clientId],
      voteCount: Object.keys(action.votes).length
    });
  }

  // ===================== ADMIN =====================

  // POST /api/admin/claim   body: { clientId, pin }
  if (req.method === 'POST' && parts.length === 3 && parts[1] === 'admin' && parts[2] === 'claim') {
    const body = await readBody(req);
    const clientId = normalizeClientId(body.clientId);
    const pin = String(body.pin || '');
    if (!clientId) return send(res, 400, { error: 'clientId requerido' });
    if (pin !== ADMIN_PIN) return send(res, 403, { error: 'PIN incorrecto' });
    if (adminClientId && adminClientId !== clientId) {
      return send(res, 409, { error: 'Ya hay un admin activo' });
    }
    adminClientId = clientId;
    const adminToken = createAdminSession(clientId);
    broadcastAdmin();
    logEvent('admin_claimed', { clientId });
    return send(res, 200, { ok: true, isAdmin: true, adminToken });
  }

  // POST /api/admin/restore   body: { clientId, adminToken }
  if (req.method === 'POST' && parts.length === 3 && parts[1] === 'admin' && parts[2] === 'restore') {
    const body = await readBody(req);
    const clientId = normalizeClientId(body.clientId);
    const token = sanitize(body.adminToken, 128);
    if (!clientId) return send(res, 400, { error: 'clientId requerido' });
    if (!validateAdminSession(clientId, token)) return send(res, 403, { error: 'Sesión admin expirada' });
    if (adminClientId && adminClientId !== clientId) {
      return send(res, 409, { error: 'Ya hay un admin activo' });
    }
    adminClientId = clientId;
    broadcastAdmin();
    logEvent('admin_restored', { clientId });
    return send(res, 200, { ok: true, isAdmin: true });
  }

  // POST /api/admin/release   body: { clientId }
  if (req.method === 'POST' && parts.length === 3 && parts[1] === 'admin' && parts[2] === 'release') {
    const body = await readBody(req);
    const clientId = normalizeClientId(body.clientId);
    if (adminClientId && adminClientId === clientId) {
      adminClientId = null;
      revokeAdminSessions(clientId);
      broadcastAdmin();
      logEvent('admin_released', { clientId, reason: 'manual' });
    }
    return send(res, 200, { ok: true });
  }

  // POST /api/sprint   body: { clientId, sprint }  (admin)
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'sprint') {
    const body = await readBody(req);
    if (!requireAdmin(req, body)) return send(res, 403, { error: 'Solo el admin puede cambiar el sprint' });
    data.sprint = sanitize(body.sprint, 16).trim() || data.sprint;
    saveData();
    broadcastSprint();
    return send(res, 200, { sprint: data.sprint });
  }

  // POST /api/board   body: { clientId, active }  (admin)
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'board') {
    const body = await readBody(req);
    if (!requireAdmin(req, body)) return send(res, 403, { error: 'Solo el admin puede activar/desactivar el tablero' });
    data.boardActive = !!body.active;
    saveData();
    broadcastBoard();
    logEvent('board_updated', { boardActive: data.boardActive });
    return send(res, 200, { boardActive: data.boardActive });
  }

  // POST /api/timer    body: { clientId, action, durationSec? }  (admin)
  if (req.method === 'POST' && parts.length === 2 && parts[1] === 'timer') {
    const body = await readBody(req);
    if (!requireAdmin(req, body)) return send(res, 403, { error: 'Solo el admin puede manejar el cronómetro' });
    const action = String(body.action || '');
    const now = Date.now();
    if (body.durationSec != null) {
      const d = Math.max(10, Math.min(60 * 60, Number(body.durationSec) || 300));
      data.timer.durationSec = d;
      // si está detenido, resetea el elapsed; si está corriendo, mantenemos
      if (!data.timer.running) data.timer.elapsedAtPause = 0;
    }
    if (action === 'start') {
      data.timer.startedAt = now;
      data.timer.elapsedAtPause = 0;
      data.timer.running = true;
    } else if (action === 'pause' && data.timer.running) {
      const elapsed = data.timer.elapsedAtPause + (now - (data.timer.startedAt || now));
      data.timer.elapsedAtPause = Math.min(data.timer.durationSec * 1000, elapsed);
      data.timer.running = false;
    } else if (action === 'resume' && !data.timer.running) {
      data.timer.startedAt = now;
      data.timer.running = true;
    } else if (action === 'reset') {
      data.timer.startedAt = 0;
      data.timer.elapsedAtPause = 0;
      data.timer.running = false;
    }
    saveData();
    broadcastTimer();
    logEvent('timer_updated', { action: action || 'duration_only', running: data.timer.running, durationSec: data.timer.durationSec });
    return send(res, 200, timerPublic());
  }

  return send(res, 404, { error: 'Endpoint no encontrado' });
}

/* ---------- Servidor ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-Id');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
    serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message || 'Error interno' }));
    }
  }
});

if (require.main === module) {
  loadData();
  server.listen(PORT, HOST, () => {
    const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log(`🏁 Retro Mario Kart corriendo en http://${shown}:${PORT}`);
    console.log(`   (accesible en la red local en http://<tu-ip>:${PORT})`);
    console.log(`   Persistencia: ${DATA_FILE ? `archivo (${DATA_FILE})` : 'memoria (no persistente)'}`);
    logEvent('server_started', { port: PORT, host: HOST, persistence: DATA_FILE ? 'file' : 'memory' });
  });

  process.on('SIGINT', () => {
    console.log('\n👋 Cerrando servidor…');
    saveDataSync();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    saveDataSync();
    process.exit(0);
  });
}

module.exports = { server, resetState, loadData, saveDataSync };
