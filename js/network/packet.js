/**
 * Formato de trama de ResQ-Mesh.
 * Este modulo no depende del DOM y puede reutilizarse desde cualquier vista.
 */

export const PROTOCOL_NAME = "RESQ-MESH";
export const PROTOCOL_VERSION = 1;

export const CRITICALITY = Object.freeze({
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
});

export const PACKET_TYPES = Object.freeze({
  ALERT: "ALERT",
  STATUS: "STATUS",
  ACK: "ACK",
});

const validCriticalities = new Set(Object.values(CRITICALITY));
const validPacketTypes = new Set(Object.values(PACKET_TYPES));

function createPacketId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `pkt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeCoordinates(coordinates = {}) {
  const latitude = Number(coordinates.latitude ?? coordinates.lat ?? -0.1807);
  const longitude = Number(coordinates.longitude ?? coordinates.lng ?? -78.4678);
  const accuracy = Number(coordinates.accuracy ?? 25);

  if (![latitude, longitude, accuracy].every(Number.isFinite)) {
    throw new TypeError("Las coordenadas y su precision deben ser numeros validos.");
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new RangeError("Las coordenadas estan fuera del rango permitido.");
  }

  return {
    latitude,
    longitude,
    accuracy,
    simulated: coordinates.simulated ?? true,
  };
}

/**
 * Crea una trama lista para transmitirse.
 * @param {object} data Datos del evento.
 * @returns {object} Trama ResQ-Mesh.
 */
export function createPacket({
  nodeId,
  nodeRole = "VICTIM",
  type = PACKET_TYPES.ALERT,
  event = "MANUAL_SOS",
  criticality = CRITICALITY.CRITICAL,
  hops = 0,
  coordinates,
  payload = {},
  timestamp = new Date().toISOString(),
  packetId = createPacketId(),
} = {}) {
  if (typeof nodeId !== "string" || nodeId.trim() === "") {
    throw new TypeError("nodeId es obligatorio y debe ser texto.");
  }

  if (!validPacketTypes.has(type)) {
    throw new TypeError(`Tipo de trama no valido: ${type}`);
  }

  if (!validCriticalities.has(criticality)) {
    throw new TypeError(`Criticidad no valida: ${criticality}`);
  }

  if (!Number.isInteger(hops) || hops < 0) {
    throw new TypeError("hops debe ser un entero mayor o igual que cero.");
  }

  if (Number.isNaN(Date.parse(timestamp))) {
    throw new TypeError("timestamp debe ser una fecha ISO valida.");
  }

  return {
    header: {
      protocol: PROTOCOL_NAME,
      version: PROTOCOL_VERSION,
      packetId,
      type,
    },
    origin: {
      nodeId: nodeId.trim(),
      role: nodeRole,
    },
    timestamp,
    hops,
    coordinates: normalizeCoordinates(coordinates),
    criticality,
    event,
    payload: { ...payload },
  };
}

/** Comprueba que un objeto tenga el formato minimo de una trama ResQ-Mesh. */
export function isValidPacket(packet) {
  return Boolean(
    packet &&
      packet.header?.protocol === PROTOCOL_NAME &&
      packet.header?.version === PROTOCOL_VERSION &&
      typeof packet.header?.packetId === "string" &&
      validPacketTypes.has(packet.header?.type) &&
      typeof packet.origin?.nodeId === "string" &&
      Number.isInteger(packet.hops) &&
      packet.hops >= 0 &&
      validCriticalities.has(packet.criticality) &&
      !Number.isNaN(Date.parse(packet.timestamp))
  );
}

/** Devuelve una copia de la trama con un salto de red adicional. */
export function addHop(packet) {
  if (!isValidPacket(packet)) {
    throw new TypeError("No se puede agregar un salto a una trama invalida.");
  }

  return {
    ...packet,
    header: { ...packet.header },
    origin: { ...packet.origin },
    coordinates: { ...packet.coordinates },
    payload: { ...packet.payload },
    hops: packet.hops + 1,
  };
}

