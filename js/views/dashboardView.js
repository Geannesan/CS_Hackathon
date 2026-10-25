// js/views/dashboardView.js
// Capa visual de ResQ-Mesh (baliza + red + mando).
// Solo PINTA: no usa micrófono, red ni estado global. La lógica (app.js) llama a esta API
// y recibe de vuelta las acciones del usuario mediante los callbacks de initDashboard().
//
//   import { initDashboard } from './views/dashboardView.js';
//   const ui = initDashboard({ onToggleSensor, onSos, onAttend, onSiren });

const MAX_TERMINAL_LINES = 200;
const DEFAULT_TARGET = 3;

const CRITICALITY = {
  CRITICAL: { label: 'CRÍTICO', rank: 4, cls: 'badge-critical' },
  HIGH:     { label: 'ALTO',    rank: 3, cls: 'badge-high' },
  MEDIUM:   { label: 'MEDIO',   rank: 2, cls: 'badge-medium' },
  LOW:      { label: 'BAJO',    rank: 1, cls: 'badge-low' },
};

const SIGNAL = {
  ACOUSTIC: { label: 'Acústica (golpes)', rank: 2, cls: 'signal-acoustic' },
  MANUAL:   { label: 'Baliza manual',     rank: 1, cls: '' },
};

const NODE_IDS = {
  victim:   'node-victim',
  repeater: 'node-repeater',
  base:     'node-base',
};

let instance = null;

/* ------------------------------ utilidades ------------------------------ */

function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[dashboardView] Falta el elemento #${id} en index.html`);
  return el;
}

/** Acepta número (ms), Date o string ISO. Devuelve ms o null. */
function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

export function formatSince(ms, now = Date.now()) {
  if (ms == null) return '—';
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 2) return 'ahora';
  if (s < 60) return `hace ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min ${s % 60} s`;
  return `hace ${Math.floor(m / 60)} h ${m % 60} min`;
}

function clock(date = new Date()) {
  return date.toTimeString().slice(0, 8);
}

function critInfo(value) {
  return CRITICALITY[String(value).toUpperCase()] ?? null;
}

/** Resumen compacto de una trama para la terminal. */
function summarize(packet) {
  if (typeof packet === 'string') return packet;
  if (packet && typeof packet === 'object' && packet.header && packet.origin) {
    return JSON.stringify({
      node: packet.origin.nodeId,
      event: packet.event,
      criticality: packet.criticality,
      hops: packet.hops,
      id: String(packet.header.packetId ?? '').slice(0, 8),
    });
  }
  try { return JSON.stringify(packet); } catch { return String(packet); }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/* -------------------------------- vista -------------------------------- */

/**
 * @param {object} handlers
 * @param {() => void}        [handlers.onToggleSensor] Botón "Activar Sensor de Escombros"
 * @param {() => void}        [handlers.onSos]          Botón "SOS MANUAL"
 * @param {(nodeId:string) => void} [handlers.onAttend] "Marcar sector atendido"
 * @param {(nodeId:string) => void} [handlers.onSiren]  "Activar sirena de respuesta"
 * @returns {object} API de la vista
 */
export function initDashboard(handlers = {}) {
  if (instance) return instance;

  const dom = {
    linkPill:     byId('link-status').closest('.link-pill'),
    linkStatus:   byId('link-status'),
    btnSensor:    byId('btn-sensor'),
    sensorStatus: byId('sensor-status'),
    vuBar:        byId('vu-bar'),
    vuValue:      byId('vu-value'),
    vuMeter:      byId('vu-bar').closest('[role="meter"]'),
    impactCounter: byId('impact-counter'),
    impactDots:   byId('impact-dots'),
    btnSos:       byId('btn-sos'),
    panelBeacon:  byId('panel-beacon'),
    adhoc:        byId('adhoc-indicator'),
    adhocLabel:   byId('adhoc-label'),
    terminal:     byId('terminal'),
    btnClear:     byId('btn-clear-terminal'),
    triageBody:   byId('triage-body'),
    triageEmpty:  byId('triage-empty'),
    pendingCount: byId('pending-count'),
    tabCount:     byId('tab-command-count'),
  };
  const impactN = dom.impactCounter.querySelector('.impact-n');
  const nodeLinks = document.querySelectorAll('.node-link');

  let lastPct = -1;
  let lastImpacts = 0;
  let victims = [];
  let emergencyTimer = null;

  /* ---------- pestañas (móvil) ---------- */
  function showPanel(name) {
    if (!['beacon', 'network', 'command'].includes(name)) return;
    document.body.dataset.view = name;
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
    });
  }
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => showPanel(tab.dataset.tab));
  });

  /* ---------- acciones del usuario ---------- */
  dom.btnSensor.addEventListener('click', () => handlers.onToggleSensor?.());
  dom.btnSos.addEventListener('click', () => handlers.onSos?.());
  dom.btnClear.addEventListener('click', () => ui.clearTerminal());

  dom.triageBody.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn || btn.disabled) return;
    const { action, nodeId } = btn.dataset;
    if (action === 'attend') handlers.onAttend?.(nodeId);
    if (action === 'siren') handlers.onSiren?.(nodeId);
  });

  /* ---------- reloj "hace X s" ---------- */
  function tick() {
    const now = Date.now();
    dom.triageBody.querySelectorAll('.since[data-ts]').forEach((cell) => {
      const text = formatSince(Number(cell.dataset.ts), now);
      if (cell.textContent !== text) cell.textContent = text;
    });
  }
  setInterval(tick, 1000);

  /* ---------- helpers de render ---------- */
  function buildDots(target) {
    dom.impactDots.replaceChildren(
      ...Array.from({ length: target }, () => el('span', 'impact-dot'))
    );
  }
  buildDots(DEFAULT_TARGET);

  function sortVictims(list) {
    return [...list].sort((a, b) => {
      if (Boolean(a.attended) !== Boolean(b.attended)) return a.attended ? 1 : -1;
      const ca = critInfo(a.criticality)?.rank ?? 0;
      const cb = critInfo(b.criticality)?.rank ?? 0;
      if (ca !== cb) return cb - ca;
      const sa = SIGNAL[a.signal]?.rank ?? 0;
      const sb = SIGNAL[b.signal]?.rank ?? 0;
      if (sa !== sb) return sb - sa;
      return (toMs(b.lastSignalAt) ?? 0) - (toMs(a.lastSignalAt) ?? 0);
    });
  }

  function buildRow(v) {
    const crit = critInfo(v.criticality);
    const sig = SIGNAL[v.signal];
    const ts = toMs(v.lastSignalAt);

    const tr = el('tr');
    if (v.attended) tr.classList.add('is-attended');
    else if (crit?.rank === 4) tr.classList.add('is-critical');

    const tdId = el('td');
    tdId.append(el('div', 'row-id', v.nodeId));
    if (v.sector) tdId.append(el('div', 'row-sub', v.sector));

    const tdSignal = el('td');
    tdSignal.append(el('span', `signal ${sig?.cls ?? ''}`.trim(), sig?.label ?? String(v.signal ?? '—')));

    const tdRisk = el('td');
    if (v.attended) tdRisk.append(el('span', 'badge badge-done', 'ATENDIDO'));
    else tdRisk.append(el('span', `badge ${crit?.cls ?? ''}`.trim(), crit?.label ?? String(v.criticality ?? '—')));

    const tdSince = el('td');
    const since = el('span', 'since', formatSince(ts));
    if (ts != null) since.dataset.ts = String(ts);
    tdSince.append(since);

    const tdActions = el('td');
    const actions = el('div', 'row-actions');
    const attend = el('button', 'btn btn-ghost btn-sm', 'Marcar sector atendido');
    attend.type = 'button';
    attend.dataset.action = 'attend';
    attend.dataset.nodeId = v.nodeId;
    attend.disabled = Boolean(v.attended);
    attend.setAttribute('aria-label', `Marcar sector atendido: ${v.nodeId}`);
    const siren = el('button', 'btn btn-ghost btn-sm', 'Activar sirena de respuesta');
    siren.type = 'button';
    siren.dataset.action = 'siren';
    siren.dataset.nodeId = v.nodeId;
    siren.setAttribute('aria-label', `Activar sirena de respuesta: ${v.nodeId}`);
    actions.append(attend, siren);
    tdActions.append(actions);

    tr.append(tdId, tdSignal, tdRisk, tdSince, tdActions);
    return tr;
  }

  /* ================================ API ================================ */
  const ui = {
    /** Cambia de pestaña en móvil: 'beacon' | 'network' | 'command'. */
    showPanel,

    /* ---- Pantalla 1: baliza ---- */
    setSensorActive(active) {
      dom.btnSensor.setAttribute('aria-pressed', String(Boolean(active)));
      dom.btnSensor.textContent = active ? 'Detener sensor' : 'Activar Sensor de Escombros';
      dom.sensorStatus.className = `sensor-status${active ? ' is-listening' : ''}`;
      dom.sensorStatus.setAttribute('role', 'status');
      dom.sensorStatus.textContent = active
        ? 'Escuchando… golpea 3 veces seguidas para emitir la alerta.'
        : 'Sensor apagado.';
      if (!active) { ui.setLevel(0); ui.setImpactCount(0); }
    },

    setSensorError(message) {
      dom.btnSensor.setAttribute('aria-pressed', 'false');
      dom.btnSensor.textContent = 'Activar Sensor de Escombros';
      dom.sensorStatus.className = 'sensor-status is-error';
      dom.sensorStatus.setAttribute('role', 'alert');
      dom.sensorStatus.textContent = message || 'No se pudo activar el sensor.';
    },

    /** @param {number} level 0..1 */
    setLevel(level) {
      const clamped = Math.min(1, Math.max(0, Number(level) || 0));
      const pct = Math.round(clamped * 100);
      if (pct === lastPct) return;
      lastPct = pct;
      dom.vuBar.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
      dom.vuValue.textContent = `${pct}%`;
      dom.vuMeter.setAttribute('aria-valuenow', String(pct));
    },

    setImpactCount(count, target = DEFAULT_TARGET) {
      const n = Math.max(0, Math.floor(Number(count) || 0));
      if (dom.impactDots.children.length !== target) buildDots(target);
      impactN.textContent = `${n} / ${target}`;
      [...dom.impactDots.children].forEach((dot, i) => dot.classList.toggle('is-on', i < n));
      dom.impactCounter.classList.toggle('is-complete', n >= target);
      if (n > lastImpacts) {
        dom.impactCounter.classList.remove('bump');
        void dom.impactCounter.offsetWidth; // reinicia la animación
        dom.impactCounter.classList.add('bump');
      }
      lastImpacts = n;
    },

    setSosActive(active) {
      dom.btnSos.setAttribute('aria-pressed', String(Boolean(active)));
      dom.btnSos.textContent = active ? 'SOS ACTIVO' : 'SOS MANUAL';
    },

    /** Destello rojo del panel cuando se dispara la emergencia automática. */
    flashEmergency(ms = 2500) {
      dom.panelBeacon.classList.add('is-emergency');
      clearTimeout(emergencyTimer);
      emergencyTimer = setTimeout(() => dom.panelBeacon.classList.remove('is-emergency'), ms);
    },

    /* ---- Pantalla 2: red ---- */
    setLinkStatus({ active = false, label } = {}) {
      dom.linkPill.classList.toggle('is-active', Boolean(active));
      dom.linkStatus.textContent = active ? 'Ad-Hoc activo' : 'Sin enlace';
      dom.adhoc.classList.toggle('is-active', Boolean(active));
      dom.adhocLabel.textContent = label
        || (active ? 'Conexión local Ad-Hoc activa' : 'Enlace local Ad-Hoc inactivo');
      nodeLinks.forEach((link) => link.classList.toggle('is-live', Boolean(active)));
    },

    /**
     * @param {'victim'|'repeater'|'base'} kind
     * @param {{battery?:number|string, criticality?:string, hops?:number, rx?:boolean|string,
     *          online?:boolean, flash?:boolean}} state  Solo se actualiza lo que se envía.
     */
    setNodeState(kind, state = {}) {
      const node = document.getElementById(NODE_IDS[kind]);
      if (!node) return;
      const field = (name) => node.querySelector(`[data-field="${name}"]`);

      if (state.battery !== undefined && field('battery')) {
        const b = Number(state.battery);
        field('battery').textContent = Number.isFinite(b) ? `${Math.round(b)}%` : String(state.battery);
        node.classList.toggle('is-lowbat', Number.isFinite(b) && b < 20);
      }
      if (state.criticality !== undefined && field('criticality')) {
        field('criticality').textContent = critInfo(state.criticality)?.label ?? String(state.criticality);
        node.classList.toggle('is-alert', critInfo(state.criticality)?.rank === 4);
      }
      if (state.hops !== undefined && field('hops')) field('hops').textContent = String(state.hops);
      if (state.rx !== undefined && field('rx')) {
        field('rx').textContent = state.rx === true ? 'Paquete recibido'
          : state.rx === false ? 'Esperando…' : String(state.rx);
      }
      node.classList.toggle('is-online', state.online !== false);

      if (state.flash || state.rx === true) {
        node.classList.remove('flash');
        void node.offsetWidth;
        node.classList.add('flash');
      }
    },

    /**
     * Añade una línea a la terminal.
     * @param {'TX'|'RX'|'SYS'|'ERR'} direction
     * @param {object|string} packet Trama ResQ-Mesh (se resume) o texto libre.
     */
    appendTerminalLine(direction, packet) {
      const t = dom.terminal;
      const nearBottom = t.scrollHeight - t.scrollTop - t.clientHeight < 40;
      t.querySelector('[data-placeholder]')?.remove();

      const dir = String(direction).toUpperCase();
      const hops = typeof packet === 'object' && packet ? packet.hops : undefined;
      const tag = dir === 'TX' ? '[TX BROADCAST]'
        : dir === 'RX' ? (hops != null ? `[RX HOP ${hops}]` : '[RX]')
        : dir === 'ERR' ? '[ERR]' : '[SYS]';

      const line = el('div', `t-line t-${dir.toLowerCase()}`);
      line.append(el('span', 't-time', clock()), el('span', 't-tag', tag), document.createTextNode(summarize(packet)));
      t.append(line);

      while (t.childElementCount > MAX_TERMINAL_LINES) t.firstElementChild.remove();
      if (nearBottom) t.scrollTop = t.scrollHeight;
    },

    clearTerminal() {
      const ph = el('div', 't-line t-sys', 'Terminal limpia. Esperando tramas…');
      ph.dataset.placeholder = '';
      dom.terminal.replaceChildren(ph);
    },

    /* ---- Pantalla 3: mando ---- */
    /**
     * Pinta la tabla de triage completa. El orden se calcula aquí:
     * pendientes primero → criticidad → acústica antes que manual → más reciente.
     * @param {Array<{nodeId:string, sector?:string, signal:'ACOUSTIC'|'MANUAL',
     *   criticality:string, lastSignalAt:number|string|Date, attended?:boolean}>} list
     */
    renderVictims(list = []) {
      victims = Array.isArray(list) ? list.filter((v) => v && typeof v.nodeId === 'string') : [];
      const sorted = sortVictims(victims);
      dom.triageBody.replaceChildren(...sorted.map(buildRow));

      const pending = victims.filter((v) => !v.attended).length;
      dom.triageEmpty.hidden = victims.length > 0;
      dom.pendingCount.textContent = String(pending);
      dom.tabCount.textContent = String(pending);
      dom.tabCount.hidden = pending === 0;
    },
  };

  ui.setLinkStatus({ active: false });
  ui.clearTerminal();
  ui.renderVictims([]);

  instance = ui;
  return ui;
}
