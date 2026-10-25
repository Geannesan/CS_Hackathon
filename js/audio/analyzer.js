// js/audio/analyzer.js
import { AUDIO_CONFIG } from '../utils/helpers.js';

let audioContext = null;
let analyserNode = null;
let microphoneSource = null;
let highpassFilter = null;
let mediaStream = null;
let floatTimeData = null;
let byteFreqData = null;
let sensitivityBoost = AUDIO_CONFIG?.GAIN_BOOST || 2.2;

export async function initAudioAnalyzer() {
    try {
        if (audioContext) {
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }
            return { success: true };
        }

        mediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1
            },
            video: false
        });

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContext = new AudioCtx();
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        microphoneSource = audioContext.createMediaStreamSource(mediaStream);

        // Filtro pasa-altos suave a 50 Hz solo para quitar el DC offset y zumbido eléctrico,
        // dejando pasar el 100% de la fuerza del golpe de nudillos en madera (80 Hz - 1200 Hz).
        highpassFilter = audioContext.createBiquadFilter();
        highpassFilter.type = 'highpass';
        highpassFilter.frequency.value = 15;

        analyserNode = audioContext.createAnalyser();
        analyserNode.fftSize = AUDIO_CONFIG?.FFT_SIZE || 2048;
        // Smoothing casi en cero para que la señal caiga al instante y detecte golpes muy seguidos
        analyserNode.smoothingTimeConstant = 0.05;

        microphoneSource.connect(highpassFilter);
        highpassFilter.connect(analyserNode);

        floatTimeData = new Float32Array(analyserNode.fftSize);
        byteFreqData = new Uint8Array(analyserNode.frequencyBinCount);

        return { success: true };
    } catch (err) {
        console.error('[ResQ-Mesh Audio] Error al acceder al micrófono:', err);
        return {
            success: false,
            error: err.name === 'NotAllowedError'
                ? 'Permiso de micrófono denegado.'
                : 'No se pudo inicializar el sensor acústico.'
        };
    }
}

export function getSignalMetrics() {
    if (!analyserNode || !floatTimeData || !audioContext) {
        return { level: 0, rms: 0, peak: 0, dominantFreq: 0, highFreqRatio: 0 };
    }

    // 1. Dominio del tiempo: Usamos el Pico del bloque reciente para máxima respuesta percusiva
    analyserNode.getFloatTimeDomainData(floatTimeData);

    let sumSquares = 0;
    let peak = 0;

    // Tomamos solo la mitad más reciente del buffer (~11 ms) para separar golpes de 0.25s sin arrastre
    const startIdx = Math.floor(floatTimeData.length * 0.5);
    const count = floatTimeData.length - startIdx;

    for (let i = startIdx; i < floatTimeData.length; i++) {
        const sample = Math.abs(floatTimeData[i]);
        sumSquares += sample * sample;
        if (sample > peak) {
            peak = sample;
        }
    }

    const rms = Math.sqrt(sumSquares / count);
    // Damos 85% de peso al pico transitorio para que el "toc" seco del nudillo suba con fuerza
    const rawEnvelope = (peak * 0.85) + (rms * 0.15);
    const normalizedLevel = Math.min(1.0, rawEnvelope * sensitivityBoost);

    // 2. Dominio de la frecuencia (FFT): Comparar banda de Madera/Golpe vs banda de Aplauso
    analyserNode.getByteFrequencyData(byteFreqData);
    const binHz = (audioContext.sampleRate / 2) / byteFreqData.length;

    let maxBinValue = 0;
    let maxBinIndex = 1;
    let lowMidEnergy = 1; // 60 Hz a 1200 Hz (Nudillos en madera, golpes estructurales)
    let highEnergy = 1;   // 2200 Hz a 6500 Hz (Aplausos, chasquidos, sibilancia)

    // Empezamos en i = 2 para ignorar el Bin 0 y 1 (DC offset)
    for (let i = 2; i < byteFreqData.length; i++) {
        const val = byteFreqData[i];
        const freq = i * binHz;

        if (val > maxBinValue) {
            maxBinValue = val;
            maxBinIndex = i;
        }

        if (freq >= 20 && freq <= 1200) {
            lowMidEnergy += val;
        } else if (freq >= 2200 && freq <= 6500) {
            highEnergy += val;
        }
    }

    const dominantFreq = Math.round(maxBinIndex * binHz);
    const highFreqRatio = Number((highEnergy / lowMidEnergy).toFixed(2));

    return {
        level: Number(normalizedLevel.toFixed(3)),
        rms: Number(rms.toFixed(3)),
        peak: Number(peak.toFixed(3)),
        dominantFreq,
        highFreqRatio
    };
}

export function getAmplitude() {
    return getSignalMetrics().level;
}

export function setSensitivityBoost(newBoost) {
    sensitivityBoost = Math.max(0.5, Math.min(6.0, newBoost));
}

export async function stopAudioAnalyzer() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    if (audioContext && audioContext.state !== 'closed') {
        await audioContext.close();
        audioContext = null;
    }
    analyserNode = null;
    microphoneSource = null;
}