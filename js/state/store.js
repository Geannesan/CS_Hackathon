// js/state/store.js
// Estado global de ResQ-Mesh: una sola "pizarra" que todos los módulos leen.
// Nadie modifica `state` directamente: se usan las acciones de este archivo.

import { createPacket, isValidPacket, PACKET_TYPES, CRITICALITY } from '../network/packet.js';

// ---------- Estado ----------
const crearNodos = () => ({
  victima: { activo: false, transmitiendo: false },
  rele:    { activo: true,  transmitiendo: false },
  base:    { activo: true,  recibioAlerta: false },
});

const state = {
  sensorActivo: false,   // ¿el micrófono está escuchando?
  enAlarma: false,       // ¿este dispositivo está emitiendo una alerta?
  impactos: 0,           // golpes detectados en la ventana actual
  nivelAudio: 0,         // 0..1, para el medidor (VU meter)
  victimas: [],          // lista de víctimas activas (tabla del rescatista)
  paquetes: [],          // log de red: historial de paquetes enviados/recibidos
  alertas: [],           // historial de alarmas locales (impactos mecánicos detectados)
  nodos: crearNodos(),   // topología: estado de los 3 nodos de la red malla
  redAdHoc: false,       // ¿la red Ad-Hoc está conectada?
  sectoresAtendidos: [], // sectores cuyas víctimas ya fueron atendidas
};

// ---------- Suscripciones ----------
const suscriptores = {};

export function subscribe(evento, fn) {
  (suscriptores[evento] ||= []).push(fn);
  return () => {
    suscriptores[evento] = suscriptores[evento].filter((f) => f !== fn);
  };
}

function emit(evento, datos) {
  [...(suscriptores[evento] || []), ...(suscriptores['*'] || [])].forEach((fn) =>
    fn(datos, evento, getState())
  );
}

// ---------- Lectura ----------
export function getState() {
  return structuredClone(state);
}

// ---------- Traducción del paquete (formato de packet.js -> formato interno) ----------
// ÚNICO lugar que conoce la estructura anidada de packet.js.
function normalizarPaquete(p) {
  return {
    id: p.header.packetId,
    type: p.header.type,
    node: p.origin.nodeId,
    role: p.origin.role,
    event: p.event,
    criticality: p.criticality,
    hops: p.hops,
    coordinates: p.coordinates, // { latitude, longitude, accuracy, simulated }
    battery: p.payload?.battery ?? null, // opcional: solo si alguien lo envía en payload
    sector: p.payload?.sector ?? null,   // opcional: ej. "A", "B"
    payload: p.payload,
    timestamp: p.timestamp,
  };
}

// ---------- Acciones (Integrante 2: audio) ----------
export function setSensorActivo(activo) {
  state.sensorActivo = activo;
  if (!activo) {
    state.impactos = 0;
    state.nivelAudio = 0;
  }
  emit('sensor:cambio', { activo });
}

export function setNivelAudio(nivel) {
  state.nivelAudio = nivel;
  emit('audio:nivel', { nivel });
}

export function registrarImpacto(cantidad) {
  state.impactos = cantidad;
  emit('impacto:registrado', { impactos: cantidad });
}

export function activarAlarma(causa = 'ACOUSTIC_IMPACTS') {
  state.enAlarma = true;
  state.alertas.unshift({ causa, timestamp: new Date().toISOString(), activa: true });
  emit('alarma:activada', { causa });
}

export function desactivarAlarma() {
  state.enAlarma = false;
  state.impactos = 0;
  state.alertas.forEach((a) => (a.activa = false));
  emit('alarma:desactivada', {});
}

// ---------- Acciones (Integrante 3: red) ----------
// Recibe la trama tal como sale de createPacket() / addHop().
export function registrarPaquete(paqueteOriginal, direccion = 'RECIBIDO') {
  // Si llega como texto JSON (otra pestaña o dispositivo), se deserializa
  if (typeof paqueteOriginal === 'string') {
    try {
      paqueteOriginal = JSON.parse(paqueteOriginal);
    } catch {
      console.warn('[store] JSON inválido ignorado:', paqueteOriginal);
      return;
    }
  }
  if (!isValidPacket(paqueteOriginal)) {
    console.warn('[store] Paquete inválido ignorado:', paqueteOriginal);
    return;
  }
  const paquete = normalizarPaquete(paqueteOriginal);

  // Evita duplicados (BroadcastChannel puede repetir mensajes).
  // Un mismo paquete con distinto número de saltos SÍ se guarda (cada salto se ve en el historial).
  const repetido = state.paquetes.some(
    (p) => p.id === paquete.id && p.direccion === direccion && p.hops === paquete.hops
  );
  if (repetido) return;

  state.paquetes.unshift({ ...paquete, direccion });
  emit('paquete:registrado', { paquete, direccion });

  // Solo las ALERTAS recibidas de un nodo VÍCTIMA crean/actualizan una víctima
  if (
    direccion === 'RECIBIDO' &&
    paquete.type === PACKET_TYPES.ALERT &&
    paquete.role === 'VICTIM'
  ) {
    agregarVictima(paquete);
    state.nodos.base.recibioAlerta = true;
    emit('nodos:cambio', { nodos: getState().nodos });
  }
}

// ---------- Topología de red (Integrante 3 la actualiza, Integrante 1 la dibuja) ----------
// nodo: 'victima' | 'rele' | 'base'. cambios: ej. { transmitiendo: true }
export function setEstadoNodo(nodo, cambios) {
  if (!state.nodos[nodo]) return;
  Object.assign(state.nodos[nodo], cambios);
  emit('nodos:cambio', { nodos: getState().nodos });
}

export function setRedAdHoc(conectada) {
  state.redAdHoc = conectada;
  emit('red:cambio', { conectada });
}

// ---------- Acciones (Integrante 1: interfaz del rescatista) ----------
function agregarVictima(paquete) {
  const datos = {
    event: paquete.event,
    criticality: paquete.criticality,
    hops: paquete.hops,
    coordinates: paquete.coordinates,
    battery: paquete.battery,
    sector: paquete.sector,
    timestamp: paquete.timestamp,
  };
  const existente = state.victimas.find((v) => v.node === paquete.node);

  if (existente) {
    Object.assign(existente, datos, { estado: 'ACTIVA' });
  } else {
    state.victimas.push({ id: paquete.id, node: paquete.node, ...datos, estado: 'ACTIVA' });
  }
  ordenarVictimas();
  emit('victimas:cambio', { victimas: getState().victimas });
}

export function marcarAtendida(nodeId) {
  const victima = state.victimas.find((v) => v.node === nodeId);
  if (!victima) return;
  victima.estado = 'ATENDIDA';
  if (victima.sector && !state.sectoresAtendidos.includes(victima.sector)) {
    state.sectoresAtendidos.push(victima.sector);
    emit('sectores:cambio', { sectores: [...state.sectoresAtendidos] });
  }
  ordenarVictimas();
  emit('victimas:cambio', { victimas: getState().victimas });
}

// Triage: activas primero -> mayor criticidad -> la que lleva más tiempo esperando
const PESO_CRITICIDAD = {
  [CRITICALITY.CRITICAL]: 4,
  [CRITICALITY.HIGH]: 3,
  [CRITICALITY.MEDIUM]: 2,
  [CRITICALITY.LOW]: 1,
};

function ordenarVictimas() {
  state.victimas.sort((a, b) => {
    if (a.estado !== b.estado) return a.estado === 'ACTIVA' ? -1 : 1;
    const dc = (PESO_CRITICIDAD[b.criticality] ?? 0) - (PESO_CRITICIDAD[a.criticality] ?? 0);
    if (dc !== 0) return dc;
    return new Date(a.timestamp) - new Date(b.timestamp);
  });
}

// ---------- Datos semilla (mock data para la demo) ----------
// Se generan con createPacket(), así siempre tienen el formato correcto.
const hace = (segundos) => new Date(Date.now() - segundos * 1000).toISOString();

function crearSemilla() {
  return [
    createPacket({
      packetId: 'seed-001', nodeId: 'VICTIMA-02', event: 'IMPACT_DETECTED',
      criticality: CRITICALITY.CRITICAL, hops: 2, timestamp: hace(95),
      coordinates: { latitude: -0.1812, longitude: -78.4671 },
      payload: { battery: 18 },
    }),
    createPacket({
      packetId: 'seed-002', nodeId: 'VICTIMA-03', event: 'MANUAL_SOS',
      criticality: CRITICALITY.HIGH, hops: 1, timestamp: hace(48),
      coordinates: { latitude: -0.1799, longitude: -78.4690 },
      payload: { battery: 54 },
    }),
    createPacket({
      packetId: 'seed-003', nodeId: 'VICTIMA-04', event: 'IMPACT_DETECTED',
      criticality: CRITICALITY.MEDIUM, hops: 3, timestamp: hace(20),
      coordinates: { latitude: -0.1821, longitude: -78.4655 },
      payload: { battery: 33 },
    }),
  ];
}

export function cargarDatosSemilla() {
  crearSemilla().forEach((p) => registrarPaquete(p, 'RECIBIDO'));
  emit('semilla:cargada', {});
}

// ---------- Reinicio (útil entre tomas del video) ----------
export function reiniciar() {
  state.sensorActivo = false;
  state.enAlarma = false;
  state.impactos = 0;
  state.nivelAudio = 0;
  state.victimas = [];
  state.paquetes = [];
  state.alertas = [];
  state.nodos = crearNodos();
  state.redAdHoc = false;
  state.sectoresAtendidos = [];
  emit('estado:reiniciado', {});
}