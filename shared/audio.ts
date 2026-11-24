// Audio format for /ws binary frames. Kept free of imports so the AudioWorklet bundle stays tiny.
export const SAMPLE_RATE = 16_000;
export const FRAME_MS = 100;
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000;
