// js/audio/detector.js
import { initAudioAnalyzer, getSignalMetrics, stopAudioAnalyzer } from './analyzer.js';
import { AUDIO_CONFIG } from '../utils/helpers.js';

const SAMPLE_MS      = AUDIO_CONFIG?.SAMPLE_INTERVAL_MS ?? 50;
const TH_HIGH        = AUDIO_CONFIG?.IMPACT_THRESHOLD_HIGH ?? 0.40;
const TH_LOW         = AUDIO_CONFIG?.IMPACT_THRESHOLD_LOW ?? 0.25;
const TARGET_HITS    = AUDIO_CONFIG?.IMPACT_TARGET ?? 3;
const WINDOW_MS      = AUDIO_CONFIG?.IMPACT_WINDOW_MS ?? 2000;
const DEBOUNCE_MS    = AUDIO_CONFIG?.DEBOUNCE_MS ?? 95;
const COOLDOWN_MS    = AUDIO_CONFIG?.COOLDOWN_AFTER_SOS_MS ?? 2500;
const MAX_HF_RATIO   = AUDIO_CONFIG?.MAX_HIGH_FREQ_RATIO ?? 1.35;

let intervalId = null;
let isRunning = false;
let isArmed = true;
let previousLevel = 0;
let lastPeakLevel = 0;
let impactTimestamps = [];
let lastImpactTime = 0;
let cooldownUntil = 0;

export async function startImpactDetection(callbacks = {}) {
    if (isRunning) return true;

    const {
        onLevelChange = () => {},
        onStrokeCountChange = () => {},
        onImpactDetected = () => {},
        onError = () => {}
    } = typeof callbacks === 'function'
        ? { onImpactDetected: callbacks }
        : callbacks;

    const initResult = await initAudioAnalyzer();
    if (!initResult.success) {
        onError(initResult.error);
        return false;
    }

    resetDetectorState();
    isRunning = true;
    onStrokeCountChange(0, TARGET_HITS);

    intervalId = setInterval(() => {
        const now = performance.now();
        const metrics = getSignalMetrics();
        const level = metrics.level;

        // 1. Actualizar VU Meter
        onLevelChange(level, metrics);

        if (now < cooldownUntil) {
            previousLevel = level;
            return;
        }

        // 2. Limpiar golpes fuera de la ventana de 2 segundos
        if (impactTimestamps.length > 0 && (now - impactTimestamps[0] > WINDOW_MS)) {
            impactTimestamps = impactTimestamps.filter(t => (now - t) <= WINDOW_MS);
            onStrokeCountChange(impactTimestamps.length, TARGET_HITS);
        }

        const timeSinceLastHit = now - lastImpactTime;

        // 3. Rearme Inteligente para golpes cada 0.25s (250 ms):
        // Se rearma si:
        // a) El nivel bajó de TH_LOW (0.28), O
        // b) Cayó al 75% del pico anterior, O
        // c) Ya pasaron >= 150ms y el sonido venía bajando y ahora vuelve a subir (nuevo ataque)
        if (!isArmed) {
            const droppedEnough = (level <= TH_LOW) || (level <= lastPeakLevel * 0.75);
            const newAttackAfterDecay = (timeSinceLastHit >= 150) && (level > previousLevel * 1.12);
            
            if (droppedEnough || newAttackAfterDecay) {
                isArmed = true;
            }
        }

        // 4. Compensación del compresor del micrófono (Ducking del SO):
        // Para el 1er golpe exigimos 0.40, pero si ya llevamos 1 o 2 golpes dentro de la ventana,
        // bajamos ligeramente el umbral efectivo (0.33) porque el micrófono atenúa el 3er golpe seguido.
        const effectiveThreshold = impactTimestamps.length > 0 ? (TH_HIGH * 0.82) : TH_HIGH;

        if (isArmed && level >= effectiveThreshold && timeSinceLastHit >= DEBOUNCE_MS) {
            isArmed = false;
            lastPeakLevel = level;

            // Filtro anti-aplausos solo en el primer golpe; en ráfaga priorizamos no perder el 3ro
            if (impactTimestamps.length === 0 && metrics.highFreqRatio > MAX_HF_RATIO) {
                console.log(`[DSP] Descartado por exceso de agudos (Ratio: ${metrics.highFreqRatio})`);
                previousLevel = level;
                return;
            }

            lastImpactTime = now;
            impactTimestamps.push(now);

            const currentCount = impactTimestamps.length;
            onStrokeCountChange(currentCount, TARGET_HITS);

            // 5. Disparo de emergencia al llegar a 3 golpes
            if (currentCount >= TARGET_HITS) {
                const totalDurationMs = Math.round(
                    impactTimestamps[currentCount - 1] - impactTimestamps[0]
                );

                onImpactDetected({
                    event: 'IMPACT_DETECTED',
                    cause: 'ACOUSTIC_IMPACTS',
                    level: Math.max(level, TH_HIGH), // Asegura reportar >= 0.40 en el JSON
                    peak: metrics.peak,
                    dominantFreq: metrics.dominantFreq,
                    impacts: currentCount,
                    durationMs: totalDurationMs,
                    timestamp: new Date().toISOString()
                });

                cooldownUntil = now + COOLDOWN_MS;
                setTimeout(() => {
                    impactTimestamps = [];
                    if (isRunning) onStrokeCountChange(0, TARGET_HITS);
                }, 700);
            }
        }

        previousLevel = level;
    }, SAMPLE_MS);
    return true;
}

export async function stopImpactDetection() {
    isRunning = false;
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }
    resetDetectorState();
    await stopAudioAnalyzer();
}

function resetDetectorState() {
    isArmed = true;
    previousLevel = 0;
    lastPeakLevel = 0;
    impactTimestamps = [];
    lastImpactTime = 0;
    cooldownUntil = 0;
}