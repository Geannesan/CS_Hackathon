// js/app.js
// Orquestador raíz de ResQ-Mesh.
// Arranca los módulos en orden y conecta lo que cruza módulos.
// Los algoritmos viven en cada módulo; aquí solo se cablea el flujo.

import * as store from './state/store.js';
import { createPacket } from './network/packet.js';
import {
  playIncomingPacketBeep,
  playRescueBeaconSiren,
  stopRescueBeaconSiren,
} from './audio/alert-sound.js';
import {
  broadcastPacket,
  onPacketReceived,
  closeChannel,
  isChannelSupported,
} from './network/channel.js';

// TODO (Int. 1): descomentar y ajustar a los nombres reales
// import { iniciarBeaconView } from './views/beaconView.js';
// import { iniciarDashboardView } from './views/dashboardView.js';

// ---------- Configuración de la demo ----------
// Se abre la misma página en dos pestañas:
//   index.html?rol=victima   -> baliza del sobreviviente
//   index.html?rol=mando     -> centro de mando del rescatista
const ROL = new URLSearchParams(location.search).get('rol') === 'mando' ? 'mando' : 'victima';
const NODE_ID = ROL === 'mando' ? 'BASE-01' : 'VICTIMA-01';

// Cuánto dura la alarma local antes de rearmarse (sirena + estado "en alarma")
const DURACION_ALARMA_MS = 8000;

// Los navegadores bloquean el audio hasta que el usuario toca la página.
// Si falla, la app sigue funcionando sin sonido.
function sonar(fn) {
  try { fn(); } catch (e) { console.warn('[app] Sonido no disponible:', e); }
}

// ---------- Sensor de impactos (Integrante 2) ----------
// detector.js se carga al pulsar el botón (import dinámico): si falta algún
// archivo del que depende (ej. utils/helpers.js), la app NO se rompe al arrancar.
export async function iniciarSensor() {
  if (store.getState().sensorActivo) return true;
  try {
    const { startImpactDetection } = await import('./audio/detector.js');
    const ok = await startImpactDetection({
      onLevelChange: (nivel) => store.setNivelAudio(nivel),
      onStrokeCountChange: (cuenta) => store.registrarImpacto(cuenta),
      onImpactDetected: (d) => store.activarAlarma(d.cause ?? 'ACOUSTIC_IMPACTS', d),
      onError: (error) => store.setErrorSensor(String(error?.message ?? error)),
    });
    if (ok) store.setSensorActivo(true);
    return ok;
  } catch (e) {
    store.setErrorSensor(String(e?.message ?? e));
    return false;
  }
}

export async function detenerSensor() {
  try {
    const { stopImpactDetection } = await import('./audio/detector.js');
    await stopImpactDetection();
  } catch (e) {
    console.warn('[app] No se pudo detener el detector:', e);
  }
  store.setSensorActivo(false);
}

// ---------- Flujo que cruza módulos ----------
let temporizadorAlarma = null;

// Alarma local (3 golpes o SOS manual) -> crear paquete -> enviarlo -> registrarlo
function conectarFlujoDeAlerta() {
  store.subscribe('alarma:activada', ({ causa, detalle = {} }) => {
    const { impacts, durationMs, level, peak, dominantFreq } = detalle;
    const payload = Object.fromEntries(
      Object.entries({ impacts, durationMs, level, peak, dominantFreq }).filter(
        ([, v]) => v !== undefined
      )
    );

    let paquete = createPacket({
      nodeId: NODE_ID,
      event: causa === 'MANUAL_SOS' ? 'MANUAL_SOS' : 'IMPACT_DETECTED', // igual que detector.js
      payload, // opcional: agregar battery o sector si se tienen
    });

    try {
      paquete = broadcastPacket(paquete); // devuelve el paquete enviado
    } catch (e) {
      console.warn('[app] No se pudo enviar por el canal:', e);
    }

    store.registrarPaquete(paquete, 'ENVIADO');
    store.setEstadoNodo('victima', { transmitiendo: true });
    setTimeout(() => store.setEstadoNodo('victima', { transmitiendo: false }), 1500);

    sonar(() => playRescueBeaconSiren(DURACION_ALARMA_MS));

    // La alarma se apaga sola para que el detector pueda volver a disparar
    clearTimeout(temporizadorAlarma);
    temporizadorAlarma = setTimeout(() => store.desactivarAlarma(), DURACION_ALARMA_MS);
  });

  store.subscribe('alarma:desactivada', () => {
    clearTimeout(temporizadorAlarma);
    sonar(() => stopRescueBeaconSiren());
  });
}

// Paquete que llega de otra pestaña -> al store
// (channel.js ya le suma 1 salto al recibirlo; el store lo guarda tal cual)
function conectarRecepcion() {
  if (!isChannelSupported()) {
    console.warn('[app] Este navegador no soporta BroadcastChannel.');
    return;
  }
  // onPacketReceived abre el canal la primera vez que se llama
  onPacketReceived((paquete) => {
    store.registrarPaquete(paquete, 'RECIBIDO');
    sonar(() => playIncomingPacketBeep());
    // Para la animación de la vista de red: el relé "transmite" un instante
    store.setEstadoNodo('rele', { transmitiendo: true });
    setTimeout(() => store.setEstadoNodo('rele', { transmitiendo: false }), 800);
  });
}

// Acciones que las vistas pueden usar sin importar app.js (evita imports circulares)
const acciones = {
  alternarSensor: () => (store.getState().sensorActivo ? detenerSensor() : iniciarSensor()),
  sosManual: () => store.activarAlarma('MANUAL_SOS'),
  cancelarAlarma: () => store.desactivarAlarma(),
  marcarAtendida: (nodeId) => store.marcarAtendida(nodeId),
};

// ---------- Arranque ----------
function iniciar() {
  // 1. Vistas primero: deben suscribirse al store ANTES de cargar la semilla
  // TODO (Int. 1): pasarles `acciones` para que sus botones funcionen
  // if (ROL === 'victima') iniciarBeaconView(acciones);
  // if (ROL === 'mando') iniciarDashboardView(acciones);

  // 2. Red
  store.setRedAdHoc(isChannelSupported());
  store.setEstadoNodo(ROL === 'mando' ? 'base' : 'victima', { activo: true });
  conectarRecepcion();
  window.addEventListener('beforeunload', () => closeChannel());

  // 3. Flujo alarma -> paquete
  conectarFlujoDeAlerta();

  // 4. Datos de demo: solo en el centro de mando
  if (ROL === 'mando') store.cargarDatosSemilla();

  // 5. Útil para depurar desde la consola del navegador
  window.resq = { store, ROL, NODE_ID, acciones, iniciarSensor, detenerSensor };
}

iniciar();