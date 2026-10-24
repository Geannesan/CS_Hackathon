import { createPacket, isValidPacket } from "./packet.js";

export const CHANNEL_NAME = "resq_mesh_network";

let channel = null;
const listeners = new Set();

function requireBroadcastChannel() {
  if (!("BroadcastChannel" in globalThis)) {
    throw new Error("Este navegador no soporta BroadcastChannel.");
  }
}

function getChannel() {
  requireBroadcastChannel();

  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", handleMessage);
    channel.addEventListener("messageerror", (error) => {
      console.error("[ResQ-Mesh] No se pudo leer una trama recibida.", error);
    });
  }

  return channel;
}

function handleMessage(messageEvent) {
  const packet = messageEvent.data;

  if (!isValidPacket(packet)) {
    console.warn("[ResQ-Mesh] Trama invalida descartada.", packet);
    return;
  }

  listeners.forEach((callback) => {
    try {
      callback(packet);
    } catch (error) {
      console.error("[ResQ-Mesh] Error en un receptor de tramas.", error);
    }
  });
}

/**
 * Transmite una trama a las otras pestanas o ventanas del mismo origen.
 * Si recibe datos crudos, crea y valida la trama antes de enviarla.
 */
export function broadcastPacket(data) {
  const packet = isValidPacket(data) ? data : createPacket(data);
  getChannel().postMessage(packet);
  return packet;
}

/**
 * Registra un receptor. Retorna una funcion para cancelar la suscripcion.
 */
export function onPacketReceived(callback) {
  if (typeof callback !== "function") {
    throw new TypeError("callback debe ser una funcion.");
  }

  getChannel();
  listeners.add(callback);

  return () => listeners.delete(callback);
}

/** Cierra el canal y elimina receptores, util al desmontar la aplicacion. */
export function closeChannel() {
  if (channel) {
    channel.removeEventListener("message", handleMessage);
    channel.close();
    channel = null;
  }

  listeners.clear();
}

export function isChannelSupported() {
  return "BroadcastChannel" in globalThis;
}

