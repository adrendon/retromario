/* =========================================================
   🏁 Retro Mario Kart — Lógica
   - Modo SERVIDOR  (http/https): API REST + SSE en tiempo real
   - Modo LOCAL     (file://)   : todo en localStorage
   ========================================================= */

const STORAGE_KEY = 'mario-kart-retro-cards-v2';
const STEPS_KEY   = 'mario-kart-retro-steps-v1';
const PILOT_KEY   = 'mario-kart-retro-current-pilot-v1';
const PILOTS_KEY  = 'mario-kart-retro-pilots-v1';
const CLIENT_ID_KEY = 'mario-kart-retro-client-id-v1';
const ADMIN_SESSION_KEY = 'mario-kart-retro-admin-token-v1';

const CATEGORIES = [
  'banana-future','shortcut-future','power-future',
  'shortcut-past','banana-past','power-past'
];

const CATEGORY_LABELS = {
  'banana-future':   '🍌 Plátanos en la ruta (riesgos futuros)',
  'shortcut-future': '🗺️ Abreviatura (atajo a probar)',
  'power-future':    '🚀 Potenciador para la victoria',
  'shortcut-past':   '🛤️ Atajos a la victoria (pasado)',
  'banana-past':     '🍌 Plátanos donde resbalamos (pasado)',
  'power-past':      '⭐ Potenciador que nos dio ventaja'
};

const CHARACTERS = [
  { emoji: '🍄', name: 'Mario' },
  { emoji: '🟢', name: 'Luigi' },
  { emoji: '👸', name: 'Peach' },
  { emoji: '👑', name: 'Daisy' },
  { emoji: '🦖', name: 'Yoshi' },
  { emoji: '🐢', name: 'Bowser' },
  { emoji: '🌟', name: 'Rosalina' },
  { emoji: '🐵', name: 'Donkey Kong' },
  { emoji: '🦍', name: 'Diddy Kong' },
  { emoji: '🐰', name: 'Toad' },
  { emoji: '👻', name: 'Boo' },
  { emoji: '🦔', name: 'Wario' },
  { emoji: '💀', name: 'Dry Bones' },
  { emoji: '🦊', name: 'Tanooki' },
  { emoji: '🐢', name: 'Koopa' },
  { emoji: '🍌', name: 'Banana' }
];

const SERVER_MODE = location.protocol === 'http:' || location.protocol === 'https:';

/* ---------- Utilidades ---------- */
function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v === null || v === undefined ? fallback : v;
  } catch { return fallback; }
}
function writeJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

function readSession(key, fallback) {
  try {
    const v = sessionStorage.getItem(key);
    return v === null || v === undefined ? fallback : v;
  } catch { return fallback; }
}
function writeSession(key, value) {
  try { sessionStorage.setItem(key, String(value)); } catch {}
}

function cryptoId() {
  if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ---------- Estado en memoria ---------- */
function emptyCards() { const o = {}; CATEGORIES.forEach(c => o[c] = []); return o; }

let cards   = emptyCards();
let pilots  = [];
let allPilots = []; // pilotos que entraron en algún momento (para el Excel)
let objective = '';
let moods   = [];     // [{ emoji, label, name, character }]
let actions = [];     // [{ id, text, author, character, ts, voters, voteCount }]

const MOODS = [
  { emoji: '😊', label: 'Optimista' },
  { emoji: '🤩', label: 'Entusiasta' },
  { emoji: '🚀', label: 'Imparable' },
  { emoji: '🎯', label: 'Enfocado' },
  { emoji: '🤔', label: 'Pensativo' },
  { emoji: '😬', label: 'Nervioso' },
  { emoji: '😠', label: 'Frustrado' },
  { emoji: '😴', label: 'Cansado' },
  { emoji: '🥶', label: 'Quemado' },
  { emoji: '🌈', label: 'Creativo' },
  { emoji: '🍌', label: 'Bloqueado' },
  { emoji: '🎉', label: 'Motivado' }
];

let currentPilot = readJSON(PILOT_KEY, null); // identidad local del usuario
if (!currentPilot) document.body.classList.add('no-pilot');
let clientId = readSession(CLIENT_ID_KEY, null) || cryptoId();
writeSession(CLIENT_ID_KEY, clientId);       // estable por pestaña para sobrevivir reconexiones SSE
let adminToken = readSession(ADMIN_SESSION_KEY, null);

/* ---------- Render: tarjetas ---------- */
function renderCategory(cat) {
  const list = document.querySelector(`.card-list[data-cat="${cat}"]`);
  if (!list) return;
  list.innerHTML = '';
  cards[cat].forEach(card => {
    const li = document.createElement('li');
    li.dataset.id = card.id;
    li.innerHTML = `
      <div class="card-row">
        <span class="card-text"></span>
        <button class="delete" title="Eliminar tarjeta" aria-label="Eliminar tarjeta">✕</button>
      </div>
      <div class="card-meta">
        <span class="char" aria-hidden="true"></span>
        <span class="author"></span>
        <span class="when"></span>
      </div>
      <div class="card-likes">
        <button type="button" class="like-btn" aria-pressed="false" title="Me gusta">
          <span class="like-icon" aria-hidden="true">🤍</span>
          <span class="like-count">0</span>
        </button>
        <span class="like-avatars" aria-label="A quién le gusta"></span>
      </div>
    `;
    li.querySelector('.card-text').textContent = card.text;
    li.querySelector('.char').textContent     = card.character || '🏁';
    li.querySelector('.author').textContent   = card.author || 'Anónimo';
    li.querySelector('.when').textContent     = '· ' + formatWhen(card.ts);

    paintLikes(li, cat, card.id, card.likeCount || 0, card.likedBy || []);

    li.querySelector('.like-btn').addEventListener('click', async () => {
      if (!SERVER_MODE) { toast('Modo local: los me gusta requieren servidor', 'warn'); return; }
      if (!currentPilot)  { toast('Únete primero para dar me gusta', 'warn'); return; }
      if (!boardActive)   { toast('El tablero no está activo', 'warn'); return; }
      try {
        const r = await fetch(`/api/cards/${encodeURIComponent(cat)}/${encodeURIComponent(card.id)}/like`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId || '' },
          body: JSON.stringify({ clientId })
        });
        if (!r.ok) {
          const out = await r.json().catch(() => ({}));
          toast(out.error || 'No se pudo registrar el me gusta', 'warn');
          return;
        }
        const out = await r.json();
        applyLikeUpdate(cat, card.id, out.likeCount, out.likedBy);
      } catch { toast('Error al dar me gusta', 'danger'); }
    });

    li.querySelector('.delete').addEventListener('click', async () => {
      li.classList.add('is-removing');
      // Actualiza local YA + avisa al servidor
      cards[cat] = cards[cat].filter(c => c.id !== card.id);
      if (SERVER_MODE) {
        try { await fetch(`/api/cards/${encodeURIComponent(cat)}/${encodeURIComponent(card.id)}`, { method: 'DELETE' }); }
        catch { toast('No se pudo borrar en el servidor', 'warn'); }
      } else {
        writeJSON(STORAGE_KEY, cards);
      }
      setTimeout(() => { renderCategory(cat); updateCounts(); }, 200);
    });
    list.appendChild(li);
  });
}

// Pinta el contador + avatars de quién dio like sobre el <li> recibido.
function paintLikes(li, cat, id, count, likedBy) {
  const btn = li.querySelector('.like-btn');
  const icon = li.querySelector('.like-icon');
  const cnt  = li.querySelector('.like-count');
  const av   = li.querySelector('.like-avatars');
  if (!btn || !av) return;
  const mineGave = (likedBy || []).some(v => currentPilot && v.name && v.name.toLowerCase() === currentPilot.name.toLowerCase());
  btn.setAttribute('aria-pressed', mineGave ? 'true' : 'false');
  btn.classList.toggle('is-on', mineGave);
  if (icon) icon.textContent = mineGave ? '❤️' : '🤍';
  if (cnt)  cnt.textContent = String(count || 0);
  av.innerHTML = '';
  (likedBy || []).slice(0, 5).forEach((v, i) => {
    const a = document.createElement('span');
    a.className = 'like-avatar';
    a.title = `${v.character || ''} ${v.name || ''}`.trim();
    a.style.background = pilotColorBg(i);
    a.style.color = pilotColorInk(i);
    a.textContent = v.character || '👤';
    av.appendChild(a);
  });
  if ((likedBy || []).length > 5) {
    const more = document.createElement('span');
    more.className = 'like-avatar like-extra';
    more.textContent = '+' + ((likedBy || []).length - 5);
    more.title = likedBy.slice(5).map(v => `${v.character || ''} ${v.name || ''}`.trim()).join('\n');
    av.appendChild(more);
  }
}

// Aplica un like update (desde el cliente local o desde SSE) y refresca la card en pantalla.
function applyLikeUpdate(cat, id, likeCount, likedBy) {
  const list = cards[cat] || [];
  const card = list.find(c => c.id === id);
  if (card) { card.likeCount = likeCount; card.likedBy = likedBy || []; }
  const li = document.querySelector(`.card-list[data-cat="${cat}"] li[data-id="${id}"]`);
  if (li) paintLikes(li, cat, id, likeCount, likedBy || []);
}

function renderAll() {
  CATEGORIES.forEach(renderCategory);
  updateCounts();
}

function updateCounts() {
  CATEGORIES.forEach(cat => {
    const h3 = document.querySelector(`.card-column.color-${cat} h3`);
    if (!h3) return;
    const count = cards[cat].length;
    let badge = h3.querySelector('.col-count');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'col-count';
      h3.appendChild(badge);
    }
    badge.textContent = count;
    badge.hidden = count === 0;
  });
}

function formatWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/* ---------- Render: pilotos ---------- */
const PILOT_COLORS = ['mario-red','luigi-green','toad-blue','star-gold','peach-pink','slate-gray'];
function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function pilotColorBg(idx) {
  const map = {
    'mario-red':   '#E62424',
    'luigi-green': '#24A148',
    'toad-blue':   '#0072CE',
    'star-gold':   '#FFD700',
    'peach-pink':  '#F3648C',
    'slate-gray':  '#555E6B',
  };
  return map[PILOT_COLORS[idx % PILOT_COLORS.length]];
}
function pilotColorInk(idx) {
  // star-gold = índice 3 → texto oscuro; el resto blanco
  return (idx % PILOT_COLORS.length === 3) ? '#333333' : '#ffffff';
}
function makePilotAvatar(p, idx, opts) {
  const a = document.createElement('span');
  a.className = 'pilot-chip-avatar';
  if (currentPilot && p.name.toLowerCase() === currentPilot.name.toLowerCase()) {
    a.classList.add('is-current');
  }
  a.style.background = pilotColorBg(idx);
  a.style.color = pilotColorInk(idx);
  a.title = `${p.character} ${p.name}`;
  // mostramos el emoji + iniciales pequeñas
  a.innerHTML = `<span aria-hidden="true" style="font-size:.95rem;line-height:1;">${p.character || ''}</span>`;
  if (opts && opts.compact) return a;
  return a;
}
function renderPilotList(targetId, countId, maxVisible) {
  const list = document.getElementById(targetId);
  const count = document.getElementById(countId);
  if (!list) return;
  list.innerHTML = '';
  if (count) count.textContent = String(pilots.length);

  if (!pilots.length) {
    const empty = document.createElement('span');
    empty.className = 'pilot-empty';
    empty.textContent = 'Aún no hay pilotos…';
    list.appendChild(empty);
    return;
  }
  const limit = maxVisible || 4;
  pilots.slice(0, limit).forEach((p, idx) => list.appendChild(makePilotAvatar(p, idx)));
  if (pilots.length > limit) {
    const extra = document.createElement('span');
    extra.className = 'pilot-chip-avatar pilot-chip-extra';
    extra.textContent = '+' + (pilots.length - limit);
    extra.title = pilots.slice(limit).map(p => `${p.character} ${p.name}`).join('\n');
    list.appendChild(extra);
  }
}
function renderPilots() {
  renderPilotList('pilot-list', 'pilot-count', 4);
  renderPilotList('pilot-list-mobile', 'pilot-count-mobile', 4);

  const current = document.getElementById('current-pilot');
  if (current) {
    if (currentPilot) {
      current.hidden = false;
      current.textContent = `Tú: ${currentPilot.character} ${currentPilot.name}`;
    } else {
      current.hidden = true;
    }
  }
  updateFormsEnabled();
  if (typeof renderLanes === 'function') renderLanes();
}

function updateFormsEnabled() {
  const has = !!currentPilot;
  document.querySelectorAll('.add-form').forEach(f => {
    const input = f.querySelector('input');
    const btn   = f.querySelector('button');
    if (input) input.disabled = !has;
    if (btn)   btn.disabled   = !has;
    if (input) input.placeholder = has
      ? (input.dataset.basePlaceholder || input.placeholder)
      : '🔒 Únete primero para escribir…';
  });
}

/* ---------- Capa de datos ---------- */
function normalizeCards(raw) {
  const out = emptyCards();
  CATEGORIES.forEach(c => {
    const list = (raw && Array.isArray(raw[c])) ? raw[c] : [];
    out[c] = list.map(item => {
      if (typeof item === 'string') {
        return { id: cryptoId(), text: item, author: '', character: '', ts: Date.now() };
      }
      return {
        id: item.id || cryptoId(),
        text: String(item.text || ''),
        author: String(item.author || ''),
        character: String(item.character || ''),
        ts: item.ts || Date.now()
      };
    });
  });
  return out;
}

function applyServerState(s, { render = true } = {}) {
  cards  = normalizeCards(s.cards);
  pilots = Array.isArray(s.pilots) ? s.pilots : [];
  allPilots = Array.isArray(s.allPilots) ? s.allPilots : pilots.slice();
  objective = typeof s.objective === 'string' ? s.objective : '';
  moods   = Array.isArray(s.moods) ? s.moods : [];
  actions = Array.isArray(s.actions) ? s.actions : [];

  applyBoardActive(!!s.boardActive);
  if (Array.isArray(s.steps)) applyStepsFromServer(s.steps);
  if (s.race) applyRaceState(s.race);
  if (typeof s.sprint === 'string') applySprint(s.sprint);
  if (s.timer) applyTimerState(s.timer);
  if (typeof s.adminTaken === 'boolean') applyAdminTaken(s.adminTaken);

  if (render) {
    renderAll();
    renderPilots();
    renderObjective();
    renderMoods();
    renderActions();
  }
}

async function loadInitial() {
  if (SERVER_MODE) {
    const r = await fetch('/api/state');
    const s = await r.json();
    applyServerState(s, { render: false });
  } else {
    cards  = normalizeCards(
      readJSON(STORAGE_KEY, null) || readJSON('mario-kart-retro-cards-v1', null) || {}
    );
    pilots = readJSON(PILOTS_KEY, []);
    objective = readJSON('mario-kart-retro-objective-v1', '');
    moods   = readJSON('mario-kart-retro-moods-v1', []);
    actions = readJSON('mario-kart-retro-actions-v1', []);
    writeJSON(STORAGE_KEY, cards);
    applyStepsFromServer(readJSON(STEPS_KEY, []));
  }
}

async function addCard(cat, payload) {
  if (SERVER_MODE) {
    const r = await fetch('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId || '' },
      body: JSON.stringify({ cat, clientId, ...payload })
    });
    if (!r.ok) throw new Error('addCard');
    const card = await r.json();
    // Insertar local YA (sin esperar al SSE)
    if (!cards[cat].some(c => c.id === card.id)) {
      cards[cat].push(card);
      renderCategory(cat); updateCounts();
    }
  } else {
    const card = { id: cryptoId(), ts: Date.now(), ...payload };
    cards[cat].push(card);
    writeJSON(STORAGE_KEY, cards);
    renderCategory(cat); updateCounts();
  }
}

async function clearBoard() {
  if (SERVER_MODE) {
    await fetch('/api/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId || '' },
      body: JSON.stringify({ clientId })
    });
  } else {
    CATEGORIES.forEach(c => cards[c] = []);
    writeJSON(STORAGE_KEY, cards);
    renderAll();
  }
}

async function registerPilot(pilot) {
  if (SERVER_MODE) {
    if (!clientId) {
      // Intenta tras conectarse al SSE
      await waitForClientId(8000);
      // Si aún no hay clientId, no es un error: el handler 'hello' del SSE
      // volverá a llamar a registerPilot automáticamente cuando se conecte.
      if (!clientId) return;
    }
    const r = await fetch('/api/pilots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, name: pilot.name, character: pilot.character })
    });
    if (!r.ok) throw new Error('registerPilot');
    const data = await r.json();
    if (Array.isArray(data.pilots)) { pilots = data.pilots; renderPilots(); }
  } else {
    const ex = pilots.find(p => p.name.toLowerCase() === pilot.name.toLowerCase());
    if (ex) ex.character = pilot.character;
    else pilots.push({ ...pilot, joinedAt: Date.now() });
    writeJSON(PILOTS_KEY, pilots);
    renderPilots();
  }
}

async function saveSteps(list) {
  if (SERVER_MODE) {
    await fetch('/api/steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId || '' },
      body: JSON.stringify({ clientId, steps: list })
    });
  } else {
    writeJSON(STEPS_KEY, list);
  }
}

function waitForClientId(timeoutMs) {
  return new Promise(resolve => {
    if (clientId) return resolve(clientId);
    const start = Date.now();
    const iv = setInterval(() => {
      if (clientId) { clearInterval(iv); resolve(clientId); }
      else if (Date.now() - start > timeoutMs) { clearInterval(iv); resolve(null); }
    }, 100);
  });
}

/* ---------- Formularios ---------- */
document.querySelectorAll('.add-form').forEach(form => {
  const cat = form.dataset.cat;
  const input = form.querySelector('input');
  input.dataset.basePlaceholder = input.placeholder;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentPilot) {
      openJoinModal();
      toast('Únete a la carrera para escribir 🏎️', 'warn');
      return;
    }
    const value = input.value.trim();
    if (!value) return;
    try {
      await addCard(cat, {
        text: value,
        author: currentPilot.name,
        character: currentPilot.character
      });
      input.value = '';
      input.focus();
    } catch {
      toast('No se pudo guardar la tarjeta 😬', 'warn');
    }
  });
});

/* ---------- Acciones globales ---------- */
document.getElementById('clear-btn').addEventListener('click', async () => {
  if (!confirm('¿Seguro que quieres borrar todas las tarjetas del tablero?')) return;
  await clearBoard();
  toast('Tablero borrado 🗑️');
});

document.getElementById('export-btn').addEventListener('click', () => {
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const today = new Date().toLocaleString('es-CO');
  const totalCards = CATEGORIES.reduce((n, c) => n + (cards[c]?.length || 0), 0);

  // Pilotos: TODOS los que entraron en esta sesión (vivos + desconectados)
  const pilotsForExcel = (Array.isArray(allPilots) && allPilots.length) ? allPilots : pilots;

  // Cabecera HTML que Excel reconoce como hoja de cálculo
  const styles = `
    <style>
      body { font-family: Segoe UI, Arial, sans-serif; }
      h1 { color:#e60012; margin:0 0 4px; }
      h2 { color:#0066c0; margin:24px 0 6px; border-bottom:2px solid #0066c0; padding-bottom:4px; }
      table { border-collapse: collapse; width: 100%; margin-bottom: 12px; }
      th, td { border: 1px solid #999; padding: 6px 10px; vertical-align: top; }
      th { background:#fde047; color:#111; text-align:left; }
      tr:nth-child(even) td { background:#f7f7f7; }
      .meta { color:#555; margin-top:18px; font-size:.9rem; }
      .empty { color:#888; font-style:italic; }
      .card-author { color:#555; font-size:.85rem; margin-top:4px; display:block; }
    </style>
  `;

  // 1) Encabezado del sprint + lista de pilotos
  let body = `
    <h1>🏁 Retro Mario Kart — Sprint ${esc(currentSprint || '')}</h1>
    <div>
      <strong>Pilotos:</strong> ${pilotsForExcel.length
        ? pilotsForExcel.map(p => esc(`${p.character || ''} ${p.name || ''}`.trim())).join(', ')
        : '<span class="empty">Sin pilotos registrados</span>'}<br>
      <strong>Total de tarjetas:</strong> ${totalCards}
    </div>
  `;

  // 2) Objetivo
  body += `<h2>🎯 Objetivo de la retro</h2>`;
  if (objective && objective.trim()) {
    body += `<table><tr><td>${esc(objective).replace(/\n/g, '<br>')}</td></tr></table>`;
  } else {
    body += `<p class="empty">No se definió un objetivo.</p>`;
  }

  // 3) Tarjetas por categoría — sin columna #, autor debajo del texto
  body += `<h2>🪧 Tarjetas por categoría</h2>`;
  CATEGORIES.forEach(cat => {
    const list = cards[cat] || [];
    const label = CATEGORY_LABELS[cat] || cat;
    body += `<h3 style="margin:18px 0 4px;color:#111;">${esc(label)}</h3>`;
    if (!list.length) {
      body += `<p class="empty">(sin tarjetas)</p>`;
      return;
    }
    body += `<table><thead><tr><th>Tarjeta</th></tr></thead><tbody>`;
    list.forEach(card => {
      const author = `${card.character || ''} ${card.author || ''}`.trim();
      body += `
        <tr>
          <td>
            ${esc(card.text)}
            <span class="card-author">— ${esc(author) || 'anónimo'}</span>
          </td>
        </tr>
      `;
    });
    body += `</tbody></table>`;
  });

  // 4) Acciones propuestas con votos
  body += `<h2>🏆 Acciones propuestas y votos</h2>`;
  if (!actions.length) {
    body += `<p class="empty">No se propusieron acciones.</p>`;
  } else {
    body += `
      <table>
        <thead>
          <tr>
            <th>Acción</th>
            <th style="width:18%">Autor</th>
            <th style="width:8%">Votos</th>
            <th style="width:30%">Votantes</th>
          </tr>
        </thead>
        <tbody>
    `;
    const sorted = actions.slice().sort((a, b) => (b.voteCount || 0) - (a.voteCount || 0));
    sorted.forEach(a => {
      const voters = (a.voterNames && a.voterNames.length)
        ? a.voterNames.map(v => `${v.character || ''} ${v.name || ''}`.trim()).filter(Boolean).join(', ')
        : '';
      body += `
        <tr>
          <td>${esc(a.text)}</td>
          <td>${esc(`${a.character || ''} ${a.author || ''}`.trim())}</td>
          <td>${a.voteCount || 0}</td>
          <td>${esc(voters) || '<span class="empty">—</span>'}</td>
        </tr>
      `;
    });
    body += `</tbody></table>`;
  }

  // 5) Fecha al final
  body += `<div class="meta"><strong>Generado:</strong> ${esc(today)}</div>`;

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <title>Retro Mario Kart Sprint ${esc(currentSprint || '')}</title>
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>Retrospectiva</x:Name>
                <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        ${styles}
      </head>
      <body>${body}</body>
    </html>
  `;

  // BOM para que Excel detecte UTF-8 correctamente (emojis y tildes)
  const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const sprintForName = (typeof currentSprint === 'string' && currentSprint) ? currentSprint : '000';
  a.download = `retro-sprint-${sprintForName}.xls`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('Excel descargado 📊', 'success');
});

/* ---------- Pasos ---------- */
const checks = document.querySelectorAll('.step-check');
const progressText = document.getElementById('progress-text');
const progressFill = document.getElementById('progress-fill');
const progressKart = document.getElementById('progress-kart');

let lastPct = 0;
function updateProgress() {
  const total = checks.length;
  const done  = [...checks].filter(c => c.checked).length;
  const pct   = total === 0 ? 0 : Math.round((done / total) * 100);
  progressText.textContent = `${done} / ${total} pasos completados`;
  progressFill.style.width = pct + '%';
  progressKart.style.left  = pct + '%';
  if (pct > lastPct) {
    progressKart.classList.remove('is-boost');
    void progressKart.offsetWidth;
    progressKart.classList.add('is-boost');
  }
  if (pct === 100 && lastPct < 100) {
    toast('🏆 ¡Vuelta de honor! Completaron todos los pasos.', 'success');
  }
  lastPct = pct;
}

function applyStepsFromServer(list) {
  const set = new Set(list);
  checks.forEach((c, i) => { c.checked = set.has(i); });
  updateProgress();
  updateStepLocks();
}

function updateStepLocks() {
  let prevDone = true;
  checks.forEach((c, i) => {
    const li = c.closest('li.step');
    if (i === 0) {
      c.disabled = false;
      if (li) li.classList.remove('is-locked');
    } else {
      c.disabled = !prevDone;
      if (li) li.classList.toggle('is-locked', !prevDone);
    }
    prevDone = prevDone && c.checked;
  });
}

function getCheckedIndices() {
  const out = []; checks.forEach((c, i) => { if (c.checked) out.push(i); }); return out;
}

checks.forEach((c, i) => {
  c.addEventListener('change', async () => {
    if (c.checked) {
      for (let j = 0; j < i; j++) {
        if (!checks[j].checked) {
          c.checked = false;
          toast(`Primero completa el paso ${j + 1} 🚧`, 'warn');
          updateStepLocks();
          return;
        }
      }
    } else {
      // Desmarcar uno desmarca también los siguientes para mantener la secuencia
      for (let j = i + 1; j < checks.length; j++) checks[j].checked = false;
    }
    updateProgress();
    updateStepLocks();
    try { await saveSteps(getCheckedIndices()); } catch {}
    // Paso 5 (índice 4) → activa/desactiva el tablero y el cronómetro.
    if (typeof handleStep5Change === 'function' && (i === 4 || i > 4)) {
      try { await handleStep5Change(checks[4] && checks[4].checked); } catch {}
    }
  });
});

updateStepLocks();

/* ---------- Modal: únete ---------- */
const joinModal  = document.getElementById('join-modal');
const joinForm   = document.getElementById('join-form');
const nameInput  = document.getElementById('pilot-name');
const charGrid   = document.getElementById('character-grid');
const changeBtn  = document.getElementById('change-pilot-btn'); // puede no existir (no se permite cambiar piloto)

function buildCharacterGrid(selected) {
  charGrid.innerHTML = '';
  const fallback = selected || CHARACTERS[0].emoji;
  CHARACTERS.forEach((ch, i) => {
    const id = `char-${i}`;
    const label = document.createElement('label');
    label.className = 'char-option';
    label.title = ch.name;
    const checked = ch.emoji === fallback ? 'checked' : '';
    label.innerHTML = `
      <input type="radio" name="character" id="${id}" value="${ch.emoji}" ${checked} />
      <span class="char-emoji" aria-hidden="true">${ch.emoji}</span>
      <span class="char-name">${ch.name}</span>
      <span class="sr-only">${ch.name}</span>
    `;
    charGrid.appendChild(label);
  });
}

function openJoinModal() {
  buildCharacterGrid(currentPilot ? currentPilot.character : null);
  if (currentPilot) nameInput.value = currentPilot.name;
  joinModal.hidden = false;
  setTimeout(() => nameInput.focus(), 50);
}
function closeJoinModal() { joinModal.hidden = true; }

joinForm.addEventListener('submit', async e => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const checked = joinForm.querySelector('input[name="character"]:checked');
  const character = checked ? checked.value : '🍄';
  if (!name) { nameInput.focus(); return; }

  currentPilot = { name, character };
  writeJSON(PILOT_KEY, currentPilot);
  document.body.classList.remove('no-pilot');
  // Si SSE aún no conectó, el handler 'hello' re-registrará al piloto automáticamente.
  registerPilot(currentPilot).catch(() => {});
  renderPilots();
  if (typeof renderMoods === 'function') renderMoods();
  if (typeof renderActions === 'function') renderActions();
  closeJoinModal();
  toast(`¡Bienvenido a la pista, ${character} ${name}! 🏁`, 'success');
  window.sfxStart && window.sfxStart();
  // El clic en "A correr" es un gesto válido del usuario → arranca la música de fondo.
  try { startMusic(); } catch {}
});

joinModal.addEventListener('click', e => {
  if (e.target === joinModal && currentPilot) closeJoinModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !joinModal.hidden && currentPilot) closeJoinModal();
});
if (changeBtn) changeBtn.addEventListener('click', openJoinModal);

/* ---------- Toasts ---------- */
function toast(message, kind) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/* ---------- MINI-CARRERA (basada en tarjetas) ----------
   Posición de cada kart = (columnas distintas donde el piloto escribió) / 6.
   Gana el primero que escriba al menos una tarjeta en las 6 columnas.
   Desempate: total de tarjetas escritas.
*/
const raceLanes   = document.getElementById('race-lanes');
const raceResults = document.getElementById('race-results');
const raceStatus  = document.getElementById('race-status');
const podiumStage = document.getElementById('podium-stage');
const podiumLosersWrap = document.getElementById('podium-losers');
const losersList  = document.getElementById('losers-list');
const raceMsg     = document.getElementById('race-msg');

let raceState = { target: 6, standings: [], winner: null };
let lastWinnerKey = null;

function escapeText(s) { return String(s).replace(/[<>&]/g, ch => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[ch])); }

function applyRaceState(rs) {
  raceState = rs || raceState;
  renderRace();
  // Ajusta visibilidad de la sección según boardActive + tarjetas
  if (typeof updateRaceVisibility === 'function') updateRaceVisibility();
  // SFX al primer ganador detectado
  if (raceState.winner) {
    const key = raceState.winner.name.toLowerCase();
    if (lastWinnerKey !== key) {
      lastWinnerKey = key;
      if (currentPilot && currentPilot.name.toLowerCase() === key) {
        toast(`🏆 ¡Ganaste la carrera, ${raceState.winner.character} ${raceState.winner.name}!`, 'success');
      } else {
        toast(`🏁 ${raceState.winner.character} ${raceState.winner.name} ganó la carrera`, 'success');
      }
      window.sfxCoin && window.sfxCoin();
    }
  } else {
    lastWinnerKey = null;
  }
}

function renderRace() {
  if (!raceLanes) return;
  raceLanes.innerHTML = '';
  const target = raceState.target || 6;
  const standings = raceState.standings || [];

  if (!standings.length) {
    const e = document.createElement('div');
    e.className = 'race-empty';
    e.textContent = 'Únete a la carrera para aparecer en la pista 🏎️';
    raceLanes.appendChild(e);
    if (raceStatus) raceStatus.hidden = true;
    if (raceResults) raceResults.hidden = true;
    return;
  }

  standings.forEach((s, idx) => {
    const lane = document.createElement('div');
    lane.className = 'race-lane';

    const kart = document.createElement('div');
    kart.className = 'race-kart';
    if (s.finished && idx === 0) kart.classList.add('is-winner');
    const pct = Math.max(2, Math.min(95, (s.columns / target) * 92 + 2));
    kart.style.left = pct + '%';

    const isMe = currentPilot && s.name.toLowerCase() === currentPilot.name.toLowerCase();
    if (isMe) kart.classList.add('is-me');

    kart.innerHTML = `
      <span class="emoji">${s.character}</span>
      <span>${escapeText(s.name)}</span>
    `;
    lane.appendChild(kart);
    raceLanes.appendChild(lane);
  });

  // Mensaje de carrera: oculto siempre (lo dicen el podio y los karts)
  if (raceStatus) raceStatus.hidden = true;
  if (raceMsg) raceMsg.innerHTML = '';

  // Podio: sólo aparece cuando alguien llegó a la meta (winner !== null)
  if (raceResults && podiumStage) {
    if (!raceState.winner) {
      raceResults.hidden = true;
      return;
    }
    raceResults.hidden = false;

    // Top 3 por orden ya calculado en el servidor (finished primero, luego columnas, luego cards)
    const top3 = standings.slice(0, 3);
    const medals = ['🥇','🥈','🥉'];
    for (let i = 0; i < 3; i++) {
      const spot = document.getElementById('podium-' + (i + 1));
      if (!spot) continue;
      const s = top3[i];
      if (!s) { spot.innerHTML = '<div class="podium-empty">—</div>'; continue; }
      spot.innerHTML = `
        <div class="podium-medal">${medals[i]}</div>
        <div class="podium-emoji">${s.character}</div>
        <div class="podium-name">${escapeText(s.name)}</div>
      `;
    }

    // Resto fuera del podio (los "llorando afuera")
    const losers = standings.slice(3);
    if (!losers.length) {
      podiumLosersWrap.hidden = true;
      losersList.innerHTML = '';
    } else {
      podiumLosersWrap.hidden = false;
      losersList.innerHTML = losers.map((s, idx) => `
        <li class="loser-item">
          <span class="loser-cry">😭</span>
          <span class="loser-rank">${idx + 4}º</span>
          <span class="loser-emoji">${s.character}</span>
          <span class="loser-name">${escapeText(s.name)}</span>
        </li>
      `).join('');
    }
  }
}

// Alias para no romper otras llamadas a renderLanes()
const renderLanes = renderRace;

/* ---------- PASO 1: botón rápido de música ---------- */
// (el botón del paso 1 ahora abre el modal #music-modal vía data-opens)

/* ---------- Apertura/cierre de modales por data-opens / data-closes ---------- */
function closeAnyModal(id) {
  const m = document.getElementById(id);
  if (m) m.hidden = true;
}
document.addEventListener('click', e => {
  const opener = e.target.closest('[data-opens]');
  if (opener) {
    const id = opener.dataset.opens;
    if (id === 'mood-modal') { openMoodModal(); return; }
    if (id === 'objective-modal') { openObjectiveModal(); return; }
    if (id === 'actions-modal')   { openActionsModal();   return; }
    if (id === 'music-modal')     { openMusicModal();     return; }
  }
  const closer = e.target.closest('[data-closes]');
  if (closer) { closeAnyModal(closer.dataset.closes); return; }
});
document.querySelectorAll('.modal-backdrop').forEach(bd => {
  // El modal de unirse y el de admin requieren completar el formulario — no se cierran con clic fuera.
  if (bd.id === 'join-modal' || bd.id === 'admin-modal') return;
  bd.addEventListener('click', e => {
    if (e.target === bd) bd.hidden = true;
  });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  ['music-modal','objective-modal','mood-modal','actions-modal'].forEach(id => {
    const m = document.getElementById(id);
    if (m && !m.hidden) m.hidden = true;
  });
});

/* ---------- PASO 2: objetivo (editar / guardar / copiar) ---------- */
const objectiveModal  = document.getElementById('objective-modal');
const objectiveText   = document.getElementById('objective-text');
const objectiveSave   = document.getElementById('objective-save');
const objectiveCopy   = document.getElementById('objective-copy');
const objectiveStatus = document.getElementById('objective-status');
let objectiveDirty = false;

function openObjectiveModal() {
  if (!objectiveModal) return;
  if (objectiveText) objectiveText.value = objective || '';
  objectiveDirty = false;
  objectiveModal.hidden = false;
  setTimeout(() => objectiveText && objectiveText.focus(), 50);
}

function renderObjective() {
  if (objectiveText) {
    // No piso lo que está escribiendo el usuario sin guardar
    if (!objectiveDirty && document.activeElement !== objectiveText) {
      objectiveText.value = objective || '';
    }
  }
  const display = document.getElementById('objective-display');
  if (display) {
    const txt = (objective || '').trim();
    if (txt) {
      display.textContent = txt;
      display.style.fontStyle = 'normal';
    } else {
      display.textContent = 'Aún no se ha definido un objetivo. Pulsa ✏️ para escribirlo.';
      display.style.fontStyle = 'italic';
    }
  }
}
function flashObjective(msg) {
  if (!objectiveStatus) return;
  objectiveStatus.textContent = msg;
  objectiveStatus.classList.add('is-visible');
  clearTimeout(flashObjective._t);
  flashObjective._t = setTimeout(() => objectiveStatus.classList.remove('is-visible'), 2000);
}
if (objectiveText) {
  objectiveText.addEventListener('input', () => { objectiveDirty = true; });
}
if (objectiveSave) {
  objectiveSave.addEventListener('click', async () => {
    const text = (objectiveText.value || '').trim();
    objective = text;
    objectiveDirty = false;
    if (SERVER_MODE) {
      try {
        await fetch('/api/objective', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text })
        });
        flashObjective('Guardado ✓');
      } catch { toast('No pude guardar el objetivo', 'warn'); }
    } else {
      writeJSON('mario-kart-retro-objective-v1', text);
      flashObjective('Guardado ✓ (local)');
    }
  });
}
if (objectiveCopy) {
  objectiveCopy.addEventListener('click', async () => {
    const text = objectiveText.value || '';
    if (!text.trim()) { toast('Aún no hay objetivo que copiar', 'warn'); return; }
    try {
      await navigator.clipboard.writeText(text);
      flashObjective('Copiado al portapapeles 📋');
      toast('Objetivo copiado', 'success');
    } catch {
      // Fallback
      objectiveText.select();
      document.execCommand('copy');
      flashObjective('Copiado');
    }
  });
}

/* ---------- PASO 3: rompehielos (modal de mood) ---------- */
const moodModal     = document.getElementById('mood-modal');
const moodGrid      = document.getElementById('mood-grid');
const moodForm      = document.getElementById('mood-form');
const moodClearBtn  = document.getElementById('mood-clear-btn');
const moodCancelBtn = document.getElementById('mood-cancel-btn');
const moodsWall     = document.getElementById('moods-wall');

function myMood() {
  if (!currentPilot) return null;
  return moods.find(m => m.name && m.name.toLowerCase() === currentPilot.name.toLowerCase());
}

function buildMoodGrid(selected) {
  if (!moodGrid) return;
  moodGrid.innerHTML = '';
  MOODS.forEach((m, i) => {
    const id = `mood-opt-${i}`;
    const label = document.createElement('label');
    label.className = 'mood-option';
    label.title = m.label;
    const checked = selected && selected === m.emoji ? 'checked' : '';
    label.innerHTML = `
      <input type="radio" name="mood" id="${id}" value="${m.emoji}" data-label="${m.label}" ${checked} />
      <span class="mood-card">
        <span class="e" aria-hidden="true">${m.emoji}</span>
        <span class="l">${m.label}</span>
      </span>
    `;
    moodGrid.appendChild(label);
  });
}
function openMoodModal() {
  if (!currentPilot) { openJoinModal(); toast('Únete antes de elegir tu ánimo 🏎️', 'warn'); return; }
  const mine = myMood();
  buildMoodGrid(mine ? mine.emoji : MOODS[0].emoji);
  moodModal.hidden = false;
}
function closeMoodModal() { moodModal.hidden = true; }

if (moodCancelBtn) moodCancelBtn.addEventListener('click', closeMoodModal);
if (moodModal) moodModal.addEventListener('click', e => { if (e.target === moodModal) closeMoodModal(); });

if (moodForm) {
  moodForm.addEventListener('submit', async e => {
    e.preventDefault();
    const checked = moodForm.querySelector('input[name="mood"]:checked');
    if (!checked) return;
    const emoji = checked.value;
    const label = checked.dataset.label || '';
    if (SERVER_MODE) {
      if (!clientId) await waitForClientId(2000);
      try {
        await fetch('/api/moods', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, emoji, label })
        });
      } catch { toast('No pude compartir tu ánimo', 'warn'); }
    } else {
      // local: reemplaza el mood del piloto actual
      moods = moods.filter(m => m.name.toLowerCase() !== currentPilot.name.toLowerCase());
      moods.push({ emoji, label, name: currentPilot.name, character: currentPilot.character });
      writeJSON('mario-kart-retro-moods-v1', moods);
      renderMoods();
    }
    closeMoodModal();
    toast(`Compartiste: ${emoji} ${label}`, 'success');
  });
}

if (moodClearBtn) {
  moodClearBtn.addEventListener('click', async () => {
    if (SERVER_MODE) {
      if (!clientId) await waitForClientId(2000);
      try {
        await fetch('/api/moods', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId })
        });
      } catch {}
    } else if (currentPilot) {
      moods = moods.filter(m => m.name.toLowerCase() !== currentPilot.name.toLowerCase());
      writeJSON('mario-kart-retro-moods-v1', moods);
      renderMoods();
    }
    closeMoodModal();
  });
}

function renderMoods() {
  if (!moodsWall) return;
  moodsWall.innerHTML = '';
  if (!moods.length) {
    const empty = document.createElement('span');
    empty.className = 'step-hint';
    empty.textContent = 'Aún nadie ha compartido su ánimo';
    moodsWall.appendChild(empty);
    return;
  }
  moods.forEach(m => {
    const span = document.createElement('span');
    span.className = 'mood-bubble';
    if (currentPilot && m.name && m.name.toLowerCase() === currentPilot.name.toLowerCase()) {
      span.classList.add('is-me');
    }
    span.innerHTML = `
      <span class="mood-emoji">${m.emoji}</span>
      <span>${(m.character || '')} ${escapeText(m.name || '')}</span>
      <span class="mood-label">· ${escapeText(m.label || '')}</span>
    `;
    moodsWall.appendChild(span);
  });
}

/* ---------- PASO 11: acciones con voto ---------- */
const actionsModal    = document.getElementById('actions-modal');
const actionsForm     = document.getElementById('actions-form');
const actionInput     = document.getElementById('action-input');
const actionsList     = document.getElementById('actions-list');
const actionsCount    = document.getElementById('actions-count');
const actionsClearBtn = document.getElementById('actions-clear');

function openActionsModal() {
  if (!actionsModal) return;
  renderActions();
  actionsModal.hidden = false;
  setTimeout(() => actionInput && actionInput.focus(), 50);
}

function renderActions() {
  if (!actionsList) return;
  actionsList.innerHTML = '';
  if (actionsCount) actionsCount.textContent = String(actions.length);

  // Sort by vote count desc, then by ts asc
  const sorted = actions.slice().sort((a, b) => (b.voteCount || 0) - (a.voteCount || 0) || a.ts - b.ts);

  if (!sorted.length) {
    const li = document.createElement('li');
    li.className = 'actions-empty';
    li.textContent = 'Aún no hay acciones propuestas. ¡Lanza la primera!';
    actionsList.appendChild(li);
  } else {
    sorted.forEach((a, idx) => {
      const li = document.createElement('li');
      li.className = 'action-item';
      if (a.voteCount > 0) {
        if (idx === 0) li.classList.add('rank-1');
        else if (idx === 1) li.classList.add('rank-2');
        else if (idx === 2) li.classList.add('rank-3');
      }
      const medal = idx === 0 && a.voteCount > 0 ? '🥇' : idx === 1 && a.voteCount > 0 ? '🥈' : idx === 2 && a.voteCount > 0 ? '🥉' : `${idx + 1}º`;
      const voted = !!(clientId && Array.isArray(a.voters) && a.voters.includes(clientId));
      const canRemove = !!(typeof isAdmin !== 'undefined' && isAdmin);
      li.innerHTML = `
        <span class="action-rank">${medal}</span>
        <span class="action-text">
          ${escapeText(a.text)}
          <small>${a.character || ''} ${escapeText(a.author || 'Anónimo')}</small>
        </span>
        <button class="action-vote-btn ${voted ? 'is-voted' : ''}" data-id="${a.id}" type="button">
          ${voted ? '✅' : '👍'} <span>${a.voteCount || 0}</span>
        </button>
        ${canRemove ? `<button class="action-remove" data-id="${a.id}" type="button" title="Eliminar mi propuesta">✕</button>` : ''}
      `;
      actionsList.appendChild(li);
    });
  }

  if (actionInput) {
    const disabled = !currentPilot || actions.length >= 5;
    actionInput.disabled = disabled;
    actionInput.placeholder = !currentPilot
      ? '🔒 Únete primero para proponer…'
      : actions.length >= 5
        ? '✋ Ya hay 5 acciones (máximo)'
        : 'Escribe una acción para el próximo sprint…';
    const submitBtn = actionsForm && actionsForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = disabled;
  }
}

if (actionsForm) {
  actionsForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentPilot) { openJoinModal(); toast('Únete antes de proponer 🏎️', 'warn'); return; }
    const text = (actionInput.value || '').trim();
    if (!text) return;
    if (SERVER_MODE) {
      if (!clientId) await waitForClientId(2000);
      try {
        const r = await fetch('/api/actions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId || '' },
          body: JSON.stringify({ clientId, text })
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          toast(err.error || 'No se pudo añadir', 'warn');
          return;
        }
        actionInput.value = '';
      } catch { toast('Error al añadir la acción', 'warn'); }
    } else {
      if (actions.length >= 5) { toast('Máximo 5 acciones', 'warn'); return; }
      actions.push({
        id: cryptoId(), text, author: currentPilot.name, character: currentPilot.character,
        ts: Date.now(), voters: [], voteCount: 0
      });
      writeJSON('mario-kart-retro-actions-v1', actions);
      renderActions();
      actionInput.value = '';
    }
  });
}

if (actionsList) {
  actionsList.addEventListener('click', async e => {
    const voteBtn = e.target.closest('.action-vote-btn');
    const rmBtn   = e.target.closest('.action-remove');
    if (voteBtn) {
      if (!currentPilot) { openJoinModal(); toast('Únete antes de votar 🏎️', 'warn'); return; }
      const id = voteBtn.dataset.id;
      if (SERVER_MODE) {
        if (!clientId) await waitForClientId(2000);
        try {
          await fetch(`/api/actions/${encodeURIComponent(id)}/vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId })
          });
        } catch { toast('No se pudo registrar el voto', 'warn'); }
      } else {
        // local: usa el nombre como identificador
        const a = actions.find(x => x.id === id);
        if (!a) return;
        a.voters = a.voters || [];
        const key = currentPilot.name.toLowerCase();
        if (a.voters.includes(key)) a.voters = a.voters.filter(v => v !== key);
        else a.voters.push(key);
        a.voteCount = a.voters.length;
        writeJSON('mario-kart-retro-actions-v1', actions);
        renderActions();
      }
    } else if (rmBtn) {
      const id = rmBtn.dataset.id;
      if (SERVER_MODE) {
        try {
          await fetch(`/api/actions/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId || '' },
            body: JSON.stringify({ clientId })
          });
        } catch { toast('No se pudo eliminar', 'warn'); }
      } else {
        actions = actions.filter(a => a.id !== id);
        writeJSON('mario-kart-retro-actions-v1', actions);
        renderActions();
      }
    }
  });
}

if (actionsClearBtn) {
  actionsClearBtn.addEventListener('click', async () => {
    if (!actions.length) return;
    if (!confirm('¿Borrar todas las acciones propuestas?')) return;
    if (SERVER_MODE) {
      try {
        await fetch('/api/actions/clear', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Client-Id': clientId || '' },
          body: JSON.stringify({ clientId })
        });
      } catch { toast('No se pudo borrar', 'warn'); }
    } else {
      actions = [];
      writeJSON('mario-kart-retro-actions-v1', actions);
      renderActions();
    }
  });
}

/* ---------- SSE: tiempo real ---------- */
let sseRetry = 0;
let connState = 'connecting';
function setConnState(state, text) {
  connState = state;
  const pill = document.getElementById('conn-pill');
  if (!pill) return;
  pill.dataset.state = state;
  const labels = {
    connecting: 'Conectando…',
    live: 'En vivo',
    polling: 'Sondeo',
    reconnecting: 'Reconectando…',
    offline: 'Sin conexión',
  };
  const txt = pill.querySelector('.conn-text');
  if (txt) txt.textContent = text || labels[state] || state;
}
if (SERVER_MODE) {
  setConnState('connecting');
} else {
  // Modo local sin servidor: ocultamos el indicador.
  document.addEventListener('DOMContentLoaded', () => {
    const pill = document.getElementById('conn-pill');
    if (pill) pill.hidden = true;
  });
}
function connectSSE() {
  if (!SERVER_MODE || typeof EventSource === 'undefined') return;
  const streamUrl = `/api/stream?clientId=${encodeURIComponent(clientId || cryptoId())}`;
  const es = new EventSource(streamUrl);

  es.addEventListener('open', () => {
    setConnState('live');
  });

  es.addEventListener('hello', e => {
    try {
      const { clientId: cid } = JSON.parse(e.data);
      clientId = cid;
      writeSession(CLIENT_ID_KEY, clientId);
      sseRetry = 0;
      setConnState('live');
      if (currentPilot) {
        registerPilot(currentPilot).catch(() => {});
      }
      restoreAdminSession().catch(() => {});
    } catch {}
  });
  es.addEventListener('snapshot', e => {
    try { applyServerState(JSON.parse(e.data)); } catch {}
  });
  es.addEventListener('card:add', e => {
    const { cat, card } = JSON.parse(e.data);
    if (!cards[cat]) return;
    if (cards[cat].some(c => c.id === card.id)) return;
    cards[cat].push(card);
    renderCategory(cat); updateCounts();
  });
  es.addEventListener('card:remove', e => {
    const { cat, id } = JSON.parse(e.data);
    if (!cards[cat]) return;
    cards[cat] = cards[cat].filter(c => c.id !== id);
    renderCategory(cat); updateCounts();
  });
  es.addEventListener('card:like', e => {
    try {
      const { cat, id, likeCount, likedBy } = JSON.parse(e.data);
      if (typeof applyLikeUpdate === 'function') applyLikeUpdate(cat, id, likeCount, likedBy);
    } catch {}
  });
  es.addEventListener('board:clear', () => {
    CATEGORIES.forEach(c => cards[c] = []);
    renderAll();
  });
  es.addEventListener('pilots:update', e => {
    try {
      const payload = JSON.parse(e.data);
      if (Array.isArray(payload)) {
        pilots = payload;
      } else {
        pilots = Array.isArray(payload.pilots) ? payload.pilots : [];
        if (Array.isArray(payload.allPilots)) allPilots = payload.allPilots;
      }
    } catch {}
    renderPilots();
    renderLanes();
  });
  es.addEventListener('steps:update', e => {
    applyStepsFromServer(JSON.parse(e.data));
  });
  es.addEventListener('race:update', e => {
    applyRaceState(JSON.parse(e.data));
  });
  es.addEventListener('objective:update', e => {
    try { objective = JSON.parse(e.data).text || ''; renderObjective(); } catch {}
  });
  es.addEventListener('moods:update', e => {
    try { moods = JSON.parse(e.data) || []; renderMoods(); } catch {}
  });
  es.addEventListener('actions:update', e => {
    try { actions = JSON.parse(e.data) || []; renderActions(); } catch {}
  });
  es.addEventListener('sprint:update', e => {
    try { applySprint(JSON.parse(e.data).sprint || ''); } catch {}
  });
  es.addEventListener('board:update', e => {
    try { applyBoardActive(!!JSON.parse(e.data).boardActive); } catch {}
  });
  es.addEventListener('timer:update', e => {
    try { applyTimerState(JSON.parse(e.data)); } catch {}
  });
  es.addEventListener('admin:update', e => {
    try { applyAdminTaken(!!JSON.parse(e.data).adminTaken); } catch {}
  });

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      sseRetry++;
      setConnState('reconnecting');
      setTimeout(connectSSE, Math.min(5000, 500 * sseRetry));
    } else {
      setConnState('reconnecting');
    }
  };
}

/* Fallback: pedimos el estado completo por si SSE perdió algún evento.
   Render/proxies a veces dejan la conexión abierta pero no entregan eventos;
   este poll evita que el tablero/cronómetro requiera recargar la página. */
if (SERVER_MODE) {
  setInterval(async () => {
    try {
      const r = await fetch('/api/state');
      if (!r.ok) {
        if (connState !== 'live') setConnState('offline');
        return;
      }
      const s = await r.json();
      applyServerState(s);
      if (connState !== 'live') setConnState('polling');
      // Si estábamos como currentPilot pero el server no nos tiene, re-registrar.
      const serverPilots = Array.isArray(s.pilots) ? s.pilots : [];
      if (currentPilot && clientId &&
          !serverPilots.some(p => p.name.toLowerCase() === currentPilot.name.toLowerCase())) {
        registerPilot(currentPilot).catch(() => {});
      }
    } catch {
      if (connState !== 'live') setConnState('offline');
    }
  }, 3000);
}

/* ---------- Notificar al servidor cuando se cierra la pestaña ---------- */
if (SERVER_MODE) {
  window.addEventListener('pagehide', () => {
    // EventSource se cierra solo → el server limpia. Esto es por si el navegador retiene la conexión.
    if (currentPilot && clientId && navigator.sendBeacon) {
      // No hay endpoint específico, pero al cerrar la página el SSE se corta
      // y el server elimina al piloto en req.on('close').
    }
  });
}

/* ---------- Sincronización entre pestañas (modo local) ---------- */
if (!SERVER_MODE) {
  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY) { cards = normalizeCards(readJSON(STORAGE_KEY, {})); renderAll(); }
    else if (e.key === PILOTS_KEY) { pilots = readJSON(PILOTS_KEY, []); renderPilots(); }
    else if (e.key === STEPS_KEY)  { applyStepsFromServer(readJSON(STEPS_KEY, [])); }
  });
}

/* ---------- MÚSICA (Web Audio, sin archivos) ---------- */
const MUSIC_KEY = 'mario-kart-retro-music-on-v1';
const MUSIC_TRACK_KEY = 'mario-kart-retro-music-track-v1';
const musicBtn = document.getElementById('music-toggle-btn');
let audioCtx = null;
let musicGain = null;
let musicTimer = null;
let musicOn = false;
let currentTrack = readJSON(MUSIC_TRACK_KEY, 'main');  // id en TRACKS

// Pista principal — Retro Kart Theme (8-bit)
const MELODY = [
  // [nota, beats] - nota en MIDI; null = silencio
  [76,1],[76,1],[null,1],[76,1],[null,1],[72,1],[76,1],[null,1],
  [79,1],[null,3],[67,1],[null,3],
  [72,1],[null,2],[67,1],[null,2],[64,1],[null,2],
  [69,1],[null,1],[71,1],[null,1],[70,1],[69,1],[null,1],
  [67,1],[76,1],[79,1],[81,1],[null,1],[77,1],[79,1],[null,1],[76,1],[null,1],[72,1],[74,1],[71,1],[null,2],
  [72,1],[null,2],[67,1],[null,2],[64,1],[null,2],
  [69,1],[null,1],[71,1],[null,1],[70,1],[69,1],[null,1],
  [67,1],[76,1],[79,1],[81,1],[null,1],[77,1],[79,1],[null,1],[76,1],[null,1],[72,1],[74,1],[71,1],[null,2]
];
const BASS = [
  [40,2],[40,2],[40,2],[40,2],
  [43,2],[43,2],[40,2],[40,2],
  [45,2],[45,2],[36,2],[36,2],
  [43,2],[43,2],[40,2],[40,2]
];

// Pista del cronómetro — tema 8-bit más rápido y tenso (Race Countdown)
const TIMER_MELODY = [
  [72,1],[76,1],[79,1],[76,1],[72,1],[76,1],[79,1],[81,1],
  [83,1],[81,1],[79,1],[76,1],[72,1],[74,1],[76,1],[null,1],
  [74,1],[77,1],[81,1],[77,1],[74,1],[77,1],[81,1],[83,1],
  [84,1],[83,1],[81,1],[79,1],[77,1],[76,1],[74,1],[null,1],
  [72,1],[79,1],[72,1],[79,1],[72,1],[79,1],[76,2],
  [74,1],[81,1],[74,1],[81,1],[74,1],[81,1],[77,2]
];
const TIMER_BASS = [
  [36,1],[43,1],[36,1],[43,1],
  [38,1],[45,1],[38,1],[45,1],
  [36,1],[43,1],[36,1],[43,1],
  [38,1],[45,1],[38,1],[45,1]
];

const BPM_MAIN  = 200;
const BPM_TIMER = 260;

// Catálogo de 5 pistas 8-bit. Cada una con melodía + bajo + bpm + icono.
const TRACKS = [
  {
    id: 'main',
    name: 'Retro Kart Theme',
    icon: '🏁',
    bpm: BPM_MAIN,
    melody: MELODY,
    bass: BASS,
  },
  {
    id: 'timer',
    name: 'Race Countdown',
    icon: '⏱️',
    bpm: BPM_TIMER,
    melody: TIMER_MELODY,
    bass: TIMER_BASS,
  },
  {
    id: 'rainbow',
    name: 'Rainbow Road',
    icon: '🌈',
    bpm: 180,
    melody: [
      [72,1],[74,1],[76,1],[79,1],[81,1],[79,1],[76,1],[74,1],
      [72,1],[76,1],[79,1],[84,1],[83,1],[79,1],[76,1],[null,1],
      [74,1],[77,1],[81,1],[84,1],[86,1],[84,1],[81,1],[77,1],
      [74,1],[77,1],[81,1],[86,1],[84,1],[81,1],[77,1],[null,1],
      [72,2],[76,2],[79,2],[84,2],
      [83,1],[81,1],[79,1],[77,1],[76,1],[74,1],[72,4]
    ],
    bass: [
      [48,2],[55,2],[48,2],[55,2],
      [50,2],[57,2],[50,2],[57,2],
      [45,2],[52,2],[45,2],[52,2],
      [43,2],[50,2],[43,4]
    ],
  },
  {
    id: 'bowser',
    name: "Bowser's Castle",
    icon: '🐢',
    bpm: 150,
    melody: [
      [55,2],[58,2],[60,2],[63,2],
      [62,1],[60,1],[58,2],[55,4],
      [55,2],[58,2],[60,2],[65,2],
      [63,1],[62,1],[60,2],[58,4],
      [48,1],[50,1],[51,1],[53,1],[55,2],[null,2],
      [55,1],[58,1],[60,1],[63,1],[62,2],[60,2]
    ],
    bass: [
      [31,2],[31,2],[34,2],[34,2],
      [36,2],[36,2],[31,2],[31,2],
      [29,2],[29,2],[34,2],[34,2],
      [31,4],[31,4]
    ],
  },
  {
    id: 'star',
    name: 'Star Power',
    icon: '⭐',
    bpm: 240,
    melody: [
      [76,1],[79,1],[84,1],[88,1],[91,1],[88,1],[84,1],[79,1],
      [76,1],[79,1],[83,1],[88,1],[91,1],[88,1],[83,1],[79,1],
      [77,1],[81,1],[84,1],[89,1],[93,1],[89,1],[84,1],[81,1],
      [76,1],[79,1],[84,1],[88,1],[91,2],[88,2],
      [84,1],[88,1],[91,1],[93,1],[96,1],[93,1],[91,1],[88,1],
      [84,2],[88,2],[91,4]
    ],
    bass: [
      [40,1],[47,1],[40,1],[47,1],[40,1],[47,1],[40,1],[47,1],
      [38,1],[45,1],[38,1],[45,1],[38,1],[45,1],[38,1],[45,1],
      [41,1],[48,1],[41,1],[48,1],[41,1],[48,1],[41,1],[48,1],
      [40,1],[47,1],[40,1],[47,1],[40,2],[47,2]
    ],
  },
];
function trackById(id) { return TRACKS.find(t => t.id === id) || TRACKS[0]; }
function trackData(id) {
  const t = trackById(id);
  return { melody: t.melody, bass: t.bass, bpm: t.bpm };
}
function getCurrentTrackName() {
  const t = trackById(currentTrack);
  return `${t.icon} ${t.name} · 8-bit`;
}
function setTrackByIndex(idx) {
  const n = TRACKS.length;
  const i = ((idx % n) + n) % n;
  setTrack(TRACKS[i].id);
  writeJSON(MUSIC_TRACK_KEY, TRACKS[i].id);
  renderTrackList();
  if (window.__syncMusicBar) window.__syncMusicBar();
  // si no está sonando, arranca para feedback inmediato al usuario.
  if (!musicOn) startMusic();
}
function currentTrackIndex() {
  const i = TRACKS.findIndex(t => t.id === currentTrack);
  return i < 0 ? 0 : i;
}
function prevTrack() { setTrackByIndex(currentTrackIndex() - 1); }
function nextTrack() { setTrackByIndex(currentTrackIndex() + 1); }

function renderTrackList() {
  const root = document.getElementById('music-track-list');
  if (!root) return;
  root.innerHTML = '';
  TRACKS.forEach((t, i) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'music-track-item' + (t.id === currentTrack ? ' is-current' : '');
    item.dataset.trackId = t.id;
    item.innerHTML = `
      <span class="mt-num">${String(i + 1).padStart(2, '0')}</span>
      <span class="mt-icon" aria-hidden="true">${t.icon}</span>
      <span class="mt-name">${t.name}</span>
      <span class="mt-bpm">${t.bpm} BPM</span>
    `;
    item.addEventListener('click', () => setTrackByIndex(i));
    root.appendChild(item);
  });
}

function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

function ensureAudio() {
  if (audioCtx) return audioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  audioCtx = new AC();
  musicGain = audioCtx.createGain();
  musicGain.gain.value = 0.08;
  musicGain.connect(audioCtx.destination);
  return audioCtx;
}

function playTone({ freq, start, dur, type = 'square', gain = 1, target }) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const env = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(gain, start + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(env);
  env.connect(target || musicGain);
  osc.start(start);
  osc.stop(start + dur + 0.05);
  // Recordamos los nodos del loop actual para poder cortarlos al cambiar de pista.
  activeNotes.push({ osc, env });
}

// Nodos del loop musical en curso (para poder cortarlos al cambiar de pista).
let activeNotes = [];
function stopActiveNotes() {
  if (!audioCtx) { activeNotes = []; return; }
  const now = audioCtx.currentTime;
  activeNotes.forEach(({ osc, env }) => {
    try {
      env.gain.cancelScheduledValues(now);
      env.gain.setValueAtTime(env.gain.value, now);
      env.gain.linearRampToValueAtTime(0, now + 0.03);
      osc.stop(now + 0.05);
    } catch {}
  });
  activeNotes = [];
}

function scheduleLoop() {
  if (!audioCtx || !musicOn) return;
  activeNotes = []; // este loop empieza con su propia lista de notas
  const { melody, bass, bpm } = trackData(currentTrack);
  const beatMs = 60000 / bpm;
  const now = audioCtx.currentTime + 0.05;
  const melodyBeats = melody.reduce((s, n) => s + n[1], 0);
  const bassBeats   = bass.reduce((s, n) => s + n[1], 0);
  const loopBeats = Math.max(melodyBeats, bassBeats);
  const loopSec = loopBeats * beatMs / 1000;

  let t = now;
  melody.forEach(([m, beats]) => {
    const dur = beats * beatMs / 1000 * 0.9;
    if (m !== null) playTone({ freq: midiToFreq(m), start: t, dur, type: 'square', gain: 1 });
    t += beats * beatMs / 1000;
  });
  let tb = now;
  bass.forEach(([m, beats]) => {
    const dur = beats * beatMs / 1000 * 0.95;
    if (m !== null) playTone({ freq: midiToFreq(m), start: tb, dur, type: 'triangle', gain: 0.7 });
    tb += beats * beatMs / 1000;
  });

  musicTimer = setTimeout(scheduleLoop, Math.max(50, loopSec * 1000 - 100));
}

function startMusic() {
  const ctx = ensureAudio();
  if (!ctx) { return; }
  if (ctx.state === 'suspended') ctx.resume();
  musicOn = true;
  writeJSON(MUSIC_KEY, true);
  musicBtn.textContent = '⏸️ Pausar';
  musicBtn.setAttribute('aria-pressed', 'true');
  musicBtn.classList.add('is-on');
  syncMusicModal();
  if (window.__syncMusicBar) window.__syncMusicBar();
  scheduleLoop();
}

function stopMusic() {
  musicOn = false;
  writeJSON(MUSIC_KEY, false);
  clearTimeout(musicTimer);
  musicTimer = null;
  stopActiveNotes();
  if (musicGain && audioCtx) {
    musicGain.gain.cancelScheduledValues(audioCtx.currentTime);
    musicGain.gain.setValueAtTime(musicGain.gain.value, audioCtx.currentTime);
    musicGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.2);
    setTimeout(() => {
      if (musicGain) { musicGain.gain.value = 0.08; }
    }, 250);
  }
  musicBtn.textContent = '▶️ Play';
  musicBtn.setAttribute('aria-pressed', 'false');
  musicBtn.classList.remove('is-on');
  syncMusicModal();
  if (window.__syncMusicBar) window.__syncMusicBar();
}

/* Cambiar de pista en caliente (sin interrumpir el botón de play) */
function setTrack(track) {
  if (currentTrack === track) return;
  currentTrack = track;
  if (musicOn) {
    clearTimeout(musicTimer);
    stopActiveNotes(); // corta las notas de la pista anterior antes de empezar la nueva
    scheduleLoop();
  }
  if (window.__syncMusicBar) window.__syncMusicBar();
}

/* ---------- MODAL de música (Paso 1) ---------- */
const musicModal       = document.getElementById('music-modal');
const musicModalToggle = document.getElementById('music-modal-toggle');
const musicStatus      = document.getElementById('music-status');
const musicVolume      = document.getElementById('music-volume');

function openMusicModal() {
  if (!musicModal) return;
  syncMusicModal();
  renderTrackList();
  musicModal.hidden = false;
}
function syncMusicModal() {
  if (musicModalToggle) {
    musicModalToggle.textContent = musicOn ? '⏸️ Pausar' : '▶️ Play';
  }
  if (musicStatus) musicStatus.textContent = musicOn ? 'Sonando 🎶' : 'En pausa';
}
if (musicModalToggle) {
  musicModalToggle.addEventListener('click', () => {
    if (musicOn) stopMusic(); else startMusic();
  });
}
if (musicVolume) {
  musicVolume.addEventListener('input', () => {
    const v = Math.max(0, Math.min(100, Number(musicVolume.value))) / 100;
    // El volumen pico interno es 0.08 (suave). Mapeamos 0..1 → 0..0.2 para no atronar.
    if (audioCtx && musicGain) {
      musicGain.gain.cancelScheduledValues(audioCtx.currentTime);
      musicGain.gain.setValueAtTime(0.2 * v, audioCtx.currentTime);
    }
  });
}

musicBtn.addEventListener('click', () => {
  if (musicOn) stopMusic(); else startMusic();
});

/* Autoarranque de música: solo si el usuario ya había activado la música antes
   (la primera vez se arranca al pulsar "¡A correr!" en el modal de unirse). */

/* SFX cortos (también Web Audio) */
function sfx(notes, type = 'square', baseGain = 0.15) {
  const ctx = ensureAudio();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const tmpGain = ctx.createGain();
  tmpGain.gain.value = baseGain;
  tmpGain.connect(ctx.destination);
  let t = ctx.currentTime + 0.01;
  notes.forEach(([m, beats]) => {
    const dur = beats * 0.12;
    if (m !== null) playTone({ freq: midiToFreq(m), start: t, dur, type, gain: 1, target: tmpGain });
    t += beats * 0.12;
  });
}

// Engancha SFX a eventos
window.sfxCoin   = () => sfx([[88,1],[95,3]], 'square', 0.18);          // moneda
window.sfxStart  = () => sfx([[72,1],[76,1],[79,1],[84,3]], 'square', 0.2); // arranque
window.sfxBoom   = () => sfx([[60,1],[55,1],[48,2]], 'sawtooth', 0.2);  // salida en falso

/* ---------- Init ---------- */
(async function init() {
  try { await loadInitial(); }
  catch { toast('No se pudo cargar el estado, sigo en modo local', 'warn'); }
  renderAll();
  renderPilots();
  renderObjective();
  renderMoods();
  renderActions();
  applyRaceState(raceState);

  connectSSE();

  // Estado de música persistido
  const wantsMusic = readJSON(MUSIC_KEY, false);
  if (wantsMusic) {
    // Autoplay está bloqueado hasta que haya interacción.
    // Marcamos el botón y esperamos un primer click en cualquier sitio.
    musicBtn.textContent = '▶️ Pulsa para reanudar música';
    const resumer = () => { startMusic(); document.removeEventListener('click', resumer, true); };
    document.addEventListener('click', resumer, true);
  }

  if (!currentPilot) {
    // Si entró por /admin, salta el modal de piloto y abre directo el de admin.
    const isAdminRoute = /^\/admin\/?$/i.test(location.pathname) || location.hash === '#admin';
    if (!isAdminRoute) openJoinModal();
  }
})();

/* =========================================================
   SPRINT · ADMIN · TABLERO · CRONÓMETRO
   ========================================================= */
const sprintHeaderEl = document.getElementById('sprint-number');
const sprintFooterEl = document.getElementById('sprint-number-footer');
let currentSprint = (sprintHeaderEl && sprintHeaderEl.textContent) || '245';
function applySprint(s) {
  currentSprint = String(s || '').trim() || currentSprint;
  if (sprintHeaderEl) sprintHeaderEl.textContent = currentSprint;
  if (sprintFooterEl) sprintFooterEl.textContent = currentSprint;
  if (adminSprintInput && document.activeElement !== adminSprintInput) {
    adminSprintInput.value = currentSprint;
  }
}

/* ---------- Tablero activo / bloqueado ---------- */
let boardActive = false;
const boardLockEl     = document.getElementById('board-lock');
const miniRaceSection = document.getElementById('mini-race');

function applyBoardActive(active) {
  boardActive = !!active;
  if (boardLockEl) boardLockEl.hidden = boardActive;
  document.querySelectorAll('.add-form').forEach(f => {
    const input = f.querySelector('input[type=text]');
    const btn   = f.querySelector('button[type=submit]');
    if (input) input.disabled = !boardActive;
    if (btn)   btn.disabled   = !boardActive;
  });
  if (adminBoardToggle) {
    // El botón está oculto: ahora el tablero se activa marcando el paso 5.
    adminBoardToggle.hidden = true;
  }
  updateRaceVisibility();
}

function updateRaceVisibility() {
  if (!miniRaceSection) return;
  const totalCards = CATEGORIES.reduce((n, c) => n + ((cards[c] && cards[c].length) || 0), 0);
  miniRaceSection.hidden = !(boardActive && totalCards > 0);
}

/* ---------- Admin ---------- */
let isAdmin = false;
let adminTaken = false;
const adminToggleBtn   = document.getElementById('admin-toggle-btn');
const adminPanelEl     = document.getElementById('admin-panel');
const adminTagEl       = document.getElementById('admin-tag');
const adminSprintInput = document.getElementById('admin-sprint');
const adminSprintSave  = document.getElementById('admin-sprint-save');
const adminTimerSelect = document.getElementById('admin-timer-duration');
const adminBoardToggle = document.getElementById('admin-board-toggle');
const adminTimerPause  = document.getElementById('admin-timer-pause');
const adminTimerReset  = document.getElementById('admin-timer-reset');
const adminReleaseBtn  = document.getElementById('admin-release');

function refreshAdminUI() {
  document.body.classList.toggle('is-admin', !!isAdmin);
  if (typeof renderActions === 'function') renderActions();
  if (adminToggleBtn) {
    // Visible cuando no eres admin (para pedir PIN). Oculto cuando ya entraste.
    adminToggleBtn.hidden = !!isAdmin;
  }
  if (adminPanelEl) adminPanelEl.hidden = !isAdmin;
  if (adminTagEl)   adminTagEl.hidden   = !isAdmin;
  document.querySelectorAll('.admin-only').forEach(el => { el.hidden = !isAdmin; });
  if (adminSprintInput && document.activeElement !== adminSprintInput) {
    adminSprintInput.value = currentSprint;
  }
}

function applyAdminTaken(taken) {
  adminTaken = !!taken;
  if (!taken && isAdmin) isAdmin = false;
  refreshAdminUI();
}

function setAdminToken(token) {
  adminToken = token || null;
  if (adminToken) writeSession(ADMIN_SESSION_KEY, adminToken);
  else { try { sessionStorage.removeItem(ADMIN_SESSION_KEY); } catch {} }
}

async function adminFetch(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': clientId || '',
      'X-Admin-Token': adminToken || ''
    },
    body: JSON.stringify({ clientId, adminToken, ...body })
  });
}

async function restoreAdminSession() {
  if (!SERVER_MODE || !clientId || !adminToken || isAdmin) return false;
  try {
    const r = await adminFetch('/api/admin/restore', {});
    if (!r.ok) {
      if (r.status === 403) setAdminToken(null);
      return false;
    }
    isAdmin = true;
    refreshAdminUI();
    closeAdminModal();
    return true;
  } catch { return false; }
}

if (adminToggleBtn) {
  adminToggleBtn.addEventListener('click', () => {
    if (!SERVER_MODE) { toast('El modo admin requiere el servidor', 'warn'); return; }
    if (adminTaken && !isAdmin) { toast('Ya hay un admin activo', 'warn'); return; }
    openAdminModal();
  });
}
if (adminReleaseBtn) {
  adminReleaseBtn.addEventListener('click', async () => {
    if (!SERVER_MODE || !clientId) return;
    try { await adminFetch('/api/admin/release', {}); } catch {}
    setAdminToken(null);
    isAdmin = false;
    refreshAdminUI();
    toast('Saliste del modo admin', 'success');
  });
}
if (adminSprintSave) {
  adminSprintSave.addEventListener('click', async () => {
    if (!isAdmin || !clientId) return;
    const v = (adminSprintInput.value || '').trim();
    if (!v) { toast('Escribe un número de sprint', 'warn'); return; }
    try {
      const r = await adminFetch('/api/sprint', { sprint: v });
      if (r.ok) toast('Sprint actualizado 🏁', 'success');
    } catch {}
  });
}
if (adminBoardToggle) {
  // Botón ocultado: la activación del tablero se hace al marcar el paso 5.
  adminBoardToggle.hidden = true;
}

// Activa/desactiva el tablero + cronómetro cuando el admin marca el paso 5.
async function handleStep5Change(active) {
  if (!isAdmin || !clientId) return;
  const want = !!active;
  if (want === boardActive) return; // ya está en el estado correcto
  try {
    await adminFetch('/api/board', { active: want });
    if (want) {
      const dur = Number(adminTimerSelect && adminTimerSelect.value) || 300;
      await adminFetch('/api/timer', { action: 'start', durationSec: dur });
      toast('Tablero activado 🟢 — cronómetro en marcha', 'success');
    } else {
      await adminFetch('/api/timer', { action: 'reset' });
      toast('Tablero desactivado 🔴', 'warn');
    }
  } catch {}
}
if (adminTimerPause) {
  adminTimerPause.addEventListener('click', async () => {
    if (!isAdmin || !clientId) return;
    const action = timerState.running ? 'pause' : 'resume';
    try { await adminFetch('/api/timer', { action }); } catch {}
  });
}
if (adminTimerReset) {
  adminTimerReset.addEventListener('click', async () => {
    if (!isAdmin || !clientId) return;
    try { await adminFetch('/api/timer', { action: 'reset' }); } catch {}
  });
}
if (adminTimerSelect) {
  adminTimerSelect.addEventListener('change', async () => {
    if (!isAdmin || !clientId) return;
    const dur = Number(adminTimerSelect.value) || 300;
    try { await adminFetch('/api/timer', { durationSec: dur }); } catch {}
  });
}

/* ---------- Cronómetro ---------- */
const boardTimerEl = document.getElementById('board-timer');
const timerClockEl = document.getElementById('timer-clock');
const timerStateEl = document.getElementById('timer-state');
let timerState = { durationSec: 300, startedAt: 0, elapsedAtPause: 0, running: false, serverNow: Date.now() };
let timerTickIv = null;
let timerOffsetMs = 0;

function applyTimerState(t) {
  timerState = { ...timerState, ...t };
  if (timerState.serverNow) timerOffsetMs = Date.now() - timerState.serverNow;
  // Música del cronómetro: si está corriendo, pista 'timer'; si no, 'main'
  if (timerState.running) {
    if (!musicOn) startMusic();
    setTrack('timer');
  } else {
    setTrack('main');
  }
  if (adminTimerPause) {
    adminTimerPause.textContent = timerState.running ? '⏸️ Pausar' : '▶️ Reanudar';
    adminTimerPause.disabled = !(timerState.startedAt || timerState.elapsedAtPause);
  }
  if (adminTimerSelect) adminTimerSelect.value = String(timerState.durationSec);
  startTimerTick();
  renderTimer();
}

function startTimerTick() {
  clearInterval(timerTickIv);
  timerTickIv = setInterval(renderTimer, 250);
}

function renderTimer() {
  if (!boardTimerEl) return;
  const hasState = !!(timerState.startedAt || timerState.elapsedAtPause);
  if (!hasState) { boardTimerEl.hidden = true; return; }
  boardTimerEl.hidden = false;

  let elapsedMs;
  if (timerState.running && timerState.startedAt) {
    const localServerNow = Date.now() - timerOffsetMs;
    elapsedMs = (timerState.elapsedAtPause || 0) + (localServerNow - timerState.startedAt);
  } else {
    elapsedMs = timerState.elapsedAtPause || 0;
  }
  const totalMs = timerState.durationSec * 1000;
  const remainingMs = Math.max(0, totalMs - elapsedMs);
  const sec = Math.ceil(remainingMs / 1000);
  const mm = String(Math.floor(sec / 60)).padStart(2, '0');
  const ss = String(sec % 60).padStart(2, '0');
  if (timerClockEl) timerClockEl.textContent = `${mm}:${ss}`;
  if (remainingMs <= 0) {
    if (timerStateEl) timerStateEl.textContent = '¡Tiempo! 🏁';
    boardTimerEl.classList.add('is-finished');
    setTrack('main');
  } else {
    boardTimerEl.classList.remove('is-finished');
    if (timerStateEl) timerStateEl.textContent = timerState.running ? '⏵ corriendo' : '⏸ en pausa';
  }
}

// Mantén la sección de mini-carrera sincronizada con los cambios de tarjetas.
// (Las funciones renderCategory / renderAll ya se llaman desde los handlers SSE de
//  card:add / card:remove / board:clear; aquí solo nos aseguramos de que esos
//  handlers también recalculen la visibilidad de la pista.)

/* ====================================================================
   MODAL DE ADMIN (PIN + nombre + personaje) — sin alerts ni prompts
   ==================================================================== */
const adminModal     = document.getElementById('admin-modal');
const adminForm      = document.getElementById('admin-form');
const adminPinInput  = document.getElementById('admin-pin');
const adminNameInput = document.getElementById('admin-name');
const adminCharGrid  = document.getElementById('admin-character-grid');
const adminCancelBtn = document.getElementById('admin-cancel');
const adminErrorBox  = document.getElementById('admin-modal-error');

function buildAdminCharacterGrid(selected) {
  if (!adminCharGrid) return;
  adminCharGrid.innerHTML = '';
  const fallback = selected || CHARACTERS[0].emoji;
  CHARACTERS.forEach((ch, i) => {
    const id = `admin-char-${i}`;
    const label = document.createElement('label');
    label.className = 'char-option';
    label.title = ch.name;
    const checked = ch.emoji === fallback ? 'checked' : '';
    label.innerHTML = `
      <input type="radio" name="admin-character" id="${id}" value="${ch.emoji}" ${checked} />
      <span class="char-emoji" aria-hidden="true">${ch.emoji}</span>
      <span class="char-name">${ch.name}</span>
    `;
    adminCharGrid.appendChild(label);
  });
}
function openAdminModal() {
  if (!adminModal) return;
  if (adminErrorBox) { adminErrorBox.hidden = true; adminErrorBox.textContent = ''; }
  buildAdminCharacterGrid(currentPilot ? currentPilot.character : null);
  if (adminNameInput && currentPilot) adminNameInput.value = currentPilot.name;
  if (adminPinInput) adminPinInput.value = '';
  adminModal.hidden = false;
  setTimeout(() => adminPinInput && adminPinInput.focus(), 50);
}
function closeAdminModal() { if (adminModal) adminModal.hidden = true; }
function showAdminError(msg) {
  if (!adminErrorBox) return;
  adminErrorBox.textContent = msg;
  adminErrorBox.hidden = false;
}
if (adminCancelBtn) adminCancelBtn.addEventListener('click', closeAdminModal);

// Si la URL es /admin (o termina con #admin), restaura sesión admin o abre el modal.
if (/^\/admin\/?$/i.test(location.pathname) || location.hash === '#admin') {
  setTimeout(async () => {
    if (!clientId) await waitForClientId(2000);
    const restored = await restoreAdminSession();
    if (!restored && !isAdmin) openAdminModal();
  }, 100);
}

if (adminForm) {
  adminForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (!SERVER_MODE) { showAdminError('El modo admin requiere el servidor'); return; }
    if (!clientId) {
      try { await waitForClientId(2000); } catch {}
      if (!clientId) { showAdminError('Aún no hay conexión con el servidor'); return; }
    }
    const pin = (adminPinInput.value || '').trim();
    if (!pin) { showAdminError('Escribe el PIN'); return; }

    const name = (adminNameInput && adminNameInput.value || '').trim();
    const checked = adminForm.querySelector('input[name="admin-character"]:checked');
    const character = checked ? checked.value : (currentPilot ? currentPilot.character : '🍄');
    if (name) {
      currentPilot = { name, character };
      writeJSON(PILOT_KEY, currentPilot);
      document.body.classList.remove('no-pilot');
      try { await registerPilot(currentPilot); } catch {}
      renderPilots();
    }

    try {
      const r = await adminFetch('/api/admin/claim', { pin });
      const out = await r.json().catch(() => ({}));
      if (!r.ok) { showAdminError(out.error || 'PIN incorrecto'); return; }
      setAdminToken(out.adminToken || null);
      isAdmin = true;
      refreshAdminUI();
      closeAdminModal();
      toast('¡Eres el admin 👑!', 'success');
    } catch { showAdminError('No se pudo conectar al servidor'); }
  });
}

/* ====================================================================
   PASOS: solo el admin puede marcarlos / desmarcarlos
   ==================================================================== */
function refreshStepsAdminLock() {
  // Re-aplica disabled tomando en cuenta el lock secuencial Y el admin
  if (typeof checks === 'undefined' || !checks) return;
  let prevDone = true;
  checks.forEach((c, i) => {
    const sequentialBlocked = i > 0 && !prevDone;
    const li = c.closest('li.step');
    c.disabled = sequentialBlocked || !isAdmin;
    if (li) {
      li.classList.toggle('is-locked', sequentialBlocked);
      li.classList.toggle('is-admin-only', !isAdmin && !sequentialBlocked);
    }
    prevDone = prevDone && c.checked;
  });
}
// Engancha refresh cuando se aplica la lista de pasos desde el server
const _origUpdateStepLocks = updateStepLocks;
updateStepLocks = function () { _origUpdateStepLocks(); refreshStepsAdminLock(); };
refreshStepsAdminLock();

/* ====================================================================
   TABLERO: ocultar TODO el grid cuando no está activo (sin mensajes)
   ==================================================================== */
const boardSectionEl = document.getElementById('retro');
const boardGridEl    = document.getElementById('board');
const boardActionsEl = document.getElementById('board-actions');

function syncBoardVisibility() {
  document.body.classList.toggle('board-active', boardActive);
  if (boardSectionEl) boardSectionEl.hidden = !boardActive;
  if (boardGridEl)    boardGridEl.hidden    = !boardActive;
  if (boardActionsEl) boardActionsEl.hidden = !boardActive || !isAdmin;
}

const _origApplyBoardActive = applyBoardActive;
applyBoardActive = function (active) {
  _origApplyBoardActive(active);
  syncBoardVisibility();
};

// Único wrapper de refreshAdminUI: actualiza candados de pasos + visibilidad del tablero.
const _origRefreshAdminUI = refreshAdminUI;
refreshAdminUI = function () {
  _origRefreshAdminUI();
  refreshStepsAdminLock();
  syncBoardVisibility();
};


/* ====================================================================
   C1: Año dinámico, music bar, carruseles, botón "Empezar carrera"
   ==================================================================== */

(function applyDynamicYear() {
  const y = new Date().getFullYear();
  ['year-header', 'year-footer'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = String(y);
  });
})();

/* ---------- Music bar (mirror del modal de música) ---------- */
(function wireMusicBar() {
  const btn = document.getElementById('music-toggle-btn');
  const trackEl = document.getElementById('music-track-bar-name');
  const statusEl = document.getElementById('music-status-bar');
  const volBar = document.getElementById('music-volume-bar');
  const volModal = document.getElementById('music-volume');
  const prev = document.getElementById('music-prev-btn');
  const next = document.getElementById('music-next-btn');

  // El icono del botón de la barra se mantiene como ▶️/⏸️ (no como label largo).
  function syncBar() {
    if (btn) {
      btn.textContent = musicOn ? '⏸️' : '▶️';
      btn.setAttribute('aria-pressed', musicOn ? 'true' : 'false');
    }
    if (statusEl) statusEl.textContent = musicOn ? 'Sonando 🎶' : 'En pausa';
    if (trackEl && typeof getCurrentTrackName === 'function') {
      trackEl.textContent = getCurrentTrackName();
    }
  }
  window.__syncMusicBar = syncBar;

  // Sustituye el texto largo que el código viejo escribía en musicBtn.
  const _origSync = typeof syncMusicModal === 'function' ? syncMusicModal : null;
  if (_origSync) {
    window.syncMusicModal = function () {
      _origSync();
      syncBar();
      // El botón compacto NO debe llevar el texto del modal.
      if (btn) btn.textContent = musicOn ? '⏸️' : '▶️';
    };
  }

  // Volumen sincronizado entre barra y modal.
  if (volBar) {
    volBar.addEventListener('input', () => {
      if (volModal) { volModal.value = volBar.value; volModal.dispatchEvent(new Event('input')); }
    });
  }
  if (prev) prev.addEventListener('click', () => { if (typeof prevTrack === 'function') prevTrack(); });
  if (next) next.addEventListener('click', () => { if (typeof nextTrack === 'function') nextTrack(); });

  syncBar();
})();

/* ---------- Carruseles (steps + board) ---------- */
(function wireCarousels() {
  const carousels = {
    steps: {
      el: document.getElementById('steps-carousel'),
      pos: document.getElementById('steps-carousel-pos'),
      itemSelector: ':scope > li',
      prevBtns: [],
      nextBtns: [],
    },
    board: {
      el: document.getElementById('board'),
      pos: document.getElementById('board-carousel-pos'),
      itemSelector: ':scope > article',
      prevBtns: [],
      nextBtns: [],
    },
  };

  function itemWidth(c) {
    const items = c.el.querySelectorAll(c.itemSelector);
    if (!items.length) return 0;
    // anchura real del primer item + gap (16px por defecto).
    const styles = getComputedStyle(c.el);
    const gap = parseFloat(styles.columnGap || styles.gap || '16') || 16;
    return items[0].getBoundingClientRect().width + gap;
  }
  function visibleCount(c) {
    const w = itemWidth(c);
    if (!w) return 1;
    return Math.max(1, Math.round(c.el.clientWidth / w));
  }
  function maxIndex(c) {
    const items = c.el.querySelectorAll(c.itemSelector);
    return Math.max(0, items.length - visibleCount(c));
  }
  function currentIndex(c) {
    const w = itemWidth(c);
    if (!w) return 0;
    return Math.round(c.el.scrollLeft / w);
  }
  function step(name, dir) {
    const c = carousels[name];
    if (!c || !c.el) return;
    const w = itemWidth(c);
    if (!w) return;
    c.el.scrollBy({ left: dir * w, behavior: 'smooth' });
    // Refresh tras la animación
    setTimeout(() => updatePos(name), 320);
  }
  function updatePos(name) {
    const c = carousels[name];
    if (!c || !c.el) return;
    const items = c.el.querySelectorAll(c.itemSelector);
    if (!items.length) {
      if (c.pos) c.pos.textContent = '0 / 0';
      c.prevBtns.forEach(b => b.disabled = true);
      c.nextBtns.forEach(b => b.disabled = true);
      return;
    }
    const idx = currentIndex(c);
    const max = maxIndex(c);
    if (c.pos) c.pos.textContent = `${Math.min(items.length, idx + 1)} / ${items.length}`;
    c.prevBtns.forEach(b => b.disabled = idx <= 0);
    c.nextBtns.forEach(b => b.disabled = idx >= max);
  }
  function refreshAll() { Object.keys(carousels).forEach(updatePos); }
  window.__carouselRefresh = refreshAll;

  // Bindings
  document.querySelectorAll('[data-carousel-prev]').forEach(btn => {
    const name = btn.dataset.carouselPrev;
    if (carousels[name]) carousels[name].prevBtns.push(btn);
    btn.addEventListener('click', () => step(name, -1));
  });
  document.querySelectorAll('[data-carousel-next]').forEach(btn => {
    const name = btn.dataset.carouselNext;
    if (carousels[name]) carousels[name].nextBtns.push(btn);
    btn.addEventListener('click', () => step(name, +1));
  });
  Object.keys(carousels).forEach(name => {
    const c = carousels[name];
    if (!c.el) return;
    c.el.addEventListener('scroll', () => updatePos(name), { passive: true });
    // Re-medir cuando cambia el contenido (cards añadidas/eliminadas).
    new MutationObserver(() => updatePos(name)).observe(c.el, { childList: true, subtree: true });
    updatePos(name);
  });
  window.addEventListener('resize', refreshAll);
})();

/* ---------- Botón "Empezar carrera" del header (admin) ---------- */
(function wireCreateRace() {
  const btn = document.getElementById('create-race-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (!SERVER_MODE) { toast('Modo local: no hay servidor', 'warn'); return; }
    if (!isAdmin) {
      toast('Solo el admin puede empezar la carrera', 'warn');
      if (typeof openAdminModal === 'function') openAdminModal();
      return;
    }
    try {
      await adminFetch('/api/board', { active: true });
      const dur = Number(adminTimerSelect && adminTimerSelect.value) || 300;
      await adminFetch('/api/timer', { action: 'start', durationSec: dur });
      toast('🏁 ¡Carrera empezada! Tablero abierto.', 'success');
      const target = document.getElementById('retro');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      toast('No se pudo iniciar la carrera', 'danger');
    }
  });
})();

/* ---------- Re-aplicar posición de carrusel del tablero cuando aparece ---------- */
(function watchBoardReveal() {
  const board = document.getElementById('board');
  const sec = document.getElementById('retro');
  if (!board || !sec) return;
  const obs = new MutationObserver(() => {
    if (window.__carouselRefresh) window.__carouselRefresh();
  });
  obs.observe(sec, { attributes: true, attributeFilter: ['hidden'] });
  obs.observe(board, { attributes: true, attributeFilter: ['hidden'] });
})();
