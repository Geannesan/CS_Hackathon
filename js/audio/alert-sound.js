// js/audio/alert-sound.js
let synthCtx = null;
let sirenInterval = null;

function getSynthContext() {
    if (!synthCtx || synthCtx.state === 'closed') {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        synthCtx = new AudioCtx();
    }
    if (synthCtx.state === 'suspended') {
        synthCtx.resume();
    }
    return synthCtx;
}

/**
 * Reproduce un doble "beep" táctico corto cuando el Centro de Mando recibe un paquete SOS.
 */
export function playIncomingPacketBeep() {
    const ctx = getSynthContext();
    const now = ctx.currentTime;

    [0, 0.15].forEach((offset, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(idx === 0 ? 880 : 1320, now + offset); // La5 -> Mi6

        gain.gain.setValueAtTime(0.25, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.12);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + offset);
        osc.stop(now + offset + 0.12);
    });
}

/**
 * Activa/Desactiva la sirena acústica de rescate de alta penetración (2500 Hz - 3200 Hz).
 * Estas frecuencias penetran mejor entre escombros y son fáciles de localizar por el oído humano.
 * @param {number} durationMs - Duración total de la sirena (por defecto 4000 ms)
 */
export function playRescueBeaconSiren(durationMs = 4000) {
    stopRescueBeaconSiren(); // Evitar solapamiento
    const ctx = getSynthContext();

    const triggerSweep = () => {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        // Barrido ascendente y descendente entre 2400 Hz y 3200 Hz
        osc.frequency.setValueAtTime(2400, now);
        osc.frequency.linearRampToValueAtTime(3200, now + 0.25);
        osc.frequency.linearRampToValueAtTime(2400, now + 0.50);

        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.52);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.52);
    };

    triggerSweep();
    sirenInterval = setInterval(triggerSweep, 600);

    setTimeout(() => {
        stopRescueBeaconSiren();
    }, durationMs);
}

export function stopRescueBeaconSiren() {
    if (sirenInterval) {
        clearInterval(sirenInterval);
        sirenInterval = null;
    }
}