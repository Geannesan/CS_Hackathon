// js/utils/helpers.js
export const AUDIO_CONFIG = {
    SAMPLE_INTERVAL_MS: 50,      // Muestreo cada 50 ms
    FFT_SIZE: 1024,              // 1024 muestras (~23ms): más limpio para separar golpes de 250ms
    IMPACT_THRESHOLD_HIGH: 0.40, // 40% para el 1er golpe
    IMPACT_THRESHOLD_LOW: 0.28,  // 28% rearme rápido
    IMPACT_TARGET: 3,            // 3 golpes
    IMPACT_WINDOW_MS: 2000,      // Ventana de 2 segundos
    DEBOUNCE_MS: 120,            // 120 ms (ideal para ritmos de 0.20s - 0.25s por golpe)
    COOLDOWN_AFTER_SOS_MS: 2500,
    GAIN_BOOST: 3.2,             // Tu valor calibrado para nudillos en madera
    MAX_HIGH_FREQ_RATIO: 1.60    // Más permisivo para no descartar el 3er nudillo por timbre
};

export const CHANNEL_NAME = 'resq_mesh_network';