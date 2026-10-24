// js/network/channel.js
import { createPacket, isValidPacket, addHop } from "./packet.js"; // <-- Importa addHop

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
  const rawPacket = messageEvent.data;

  if (!isValidPacket(rawPacket)) {
    console.warn("[ResQ-Mesh] Trama invalida descartada.", rawPacket);
    return;
  }

  // REGLA TELEMÁTICA: Incrementar el salto al ser recibido por otro nodo de la malla
  const packet = addHop(rawPacket);

  listeners.forEach((callback) => {
    try {
      callback(packet);
    } catch (error) {
      console.error("[ResQ-Mesh] Error en un receptor de tramas.", error);
    }
  });
}

export function broadcastPacket(data) {
  const packet = isValidPacket(data) ? data : createPacket(data);
  getChannel().postMessage(packet);
  return packet;
}

export function onPacketReceived(callback) {
  if (typeof callback !== "function") {
    throw new TypeError("callback debe ser una funcion.");
  }

  getChannel();
  listeners.add(callback);

  return () => listeners.delete(callback);
}

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