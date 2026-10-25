// js/views/dashboardBinding.js
// Pegamento entre el store (estado) y la vista (dashboardView.js).
// - Estado -> pantalla: se suscribe a los eventos del store y llama a la API de la vista.
// - Pantalla -> acciones: los botones de la vista llaman a `acciones` (definidas en app.js).
// No contiene lógica de audio ni de red.

import { initDashboard } from './dashboardView.js';
import * as store from '../state/store.js';

/** Paquete normalizado del store -> objeto que la terminal sabe resumir. */
function paraTerminal(p) {
  return {
    header: { packetId: p.id },
    origin: { nodeId: p.node },
    event: p.event,
    criticality: p.criticality,
    hops: p.hops,
  };
}

/** Víctima del store -> fila de la tabla de triage. */
function aFila(v) {
  return {
    nodeId: v.node,
    sector: v.sector ?? undefined,
    signal: v.event === 'MANUAL_SOS' ? 'MANUAL' : 'ACOUSTIC',
    criticality: v.criticality,
    lastSignalAt: v.timestamp,
    attended: v.estado === 'ATENDIDA',
  };
}

/**
 * @param {object} acciones  { alternarSensor, sosManual, cancelarAlarma, marcarAtendida, activarSirenaRespuesta }
 * @param {{rol:'victima'|'mando', nodeId:string}} contexto
 */
export function conectarDashboard(acciones, { rol, nodeId }) {
  const ui = initDashboard({
    onToggleSensor: () => acciones.alternarSensor(),
    onSos: () => (store.getState().enAlarma ? acciones.cancelarAlarma() : acciones.sosManual()),
    onAttend: (id) => acciones.marcarAtendida(id),
    onSiren: (id) => acciones.activarSirenaRespuesta(id),
  });

  // Cada rol abre en su pestaña (solo se nota en móvil)
  ui.showPanel(rol === 'mando' ? 'command' : 'beacon');
  document.body.dataset.rol = rol;

  // ----- Baliza -----
  store.subscribe('sensor:cambio', ({ activo }) => ui.setSensorActive(activo));
  store.subscribe('sensor:error', ({ mensaje }) => ui.setSensorError(mensaje));
  store.subscribe('audio:nivel', ({ nivel }) => ui.setLevel(nivel));
  store.subscribe('impacto:registrado', ({ impactos }) => ui.setImpactCount(impactos));
  store.subscribe('alarma:activada', () => {
    ui.setSosActive(true);
    ui.flashEmergency(2500);
  });
  store.subscribe('alarma:desactivada', () => {
    ui.setSosActive(false);
    ui.setImpactCount(0);
  });

  // ----- Red -----
  store.subscribe('red:cambio', ({ conectada }) =>
    ui.setLinkStatus({
      active: conectada,
      label: conectada ? `Malla local activa · ${nodeId}` : 'Enlace local Ad-Hoc inactivo',
    })
  );

  store.subscribe('paquete:registrado', ({ paquete, direccion }) => {
    const enviado = direccion === 'ENVIADO';
    ui.appendTerminalLine(enviado ? 'TX' : 'RX', paraTerminal(paquete));

    // Solo las alertas de una víctima alimentan las tarjetas de nodos
    if (paquete.type !== 'ALERT' || paquete.role !== 'VICTIM') return;
    ui.setNodeState('victim', {
      battery: paquete.battery ?? '—',
      criticality: paquete.criticality,
      flash: true,
    });
    if (!enviado) {
      ui.setNodeState('repeater', { hops: paquete.hops, flash: true });
      ui.setNodeState('base', { rx: true });
    }
  });

  // ----- Mando -----
  store.subscribe('victimas:cambio', ({ victimas }) => ui.renderVictims(victimas.map(aFila)));

  return ui;
}
