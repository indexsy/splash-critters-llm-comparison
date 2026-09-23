// Chip-style waveforms built once per AudioContext and cached: NES-like pulse waves with
// narrow duty cycles (PeriodicWave) and noise buffers (white + short-mode LFSR "metal").

export type NoiseColor = 'white' | 'metal';

const PULSE_HARMONICS = 48;
const WHITE_SECONDS = 1;
/** Samples each LFSR state is held for: sets the metallic noise's base pitch. */
const METAL_HOLD_SAMPLES = 3;

const pulseCache = new WeakMap<BaseAudioContext, Map<number, PeriodicWave>>();
const noiseCache = new WeakMap<BaseAudioContext, Map<NoiseColor, AudioBuffer>>();

/**
 * Fourier coefficients of a pulse wave with the given duty cycle (0.5 = square).
 * a_n = sin(2*pi*n*d) / (pi*n), b_n = (1 - cos(2*pi*n*d)) / (pi*n).
 */
export function pulseCoefficients(duty: number, harmonics: number): { real: Float32Array; imag: Float32Array } {
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    const angle = 2 * Math.PI * n * duty;
    real[n] = Math.sin(angle) / (Math.PI * n);
    imag[n] = (1 - Math.cos(angle)) / (Math.PI * n);
  }
  return { real, imag };
}

export function pulseWave(ctx: BaseAudioContext, duty: number): PeriodicWave {
  let byDuty = pulseCache.get(ctx);
  if (!byDuty) {
    byDuty = new Map();
    pulseCache.set(ctx, byDuty);
  }
  let wave = byDuty.get(duty);
  if (!wave) {
    const { real, imag } = pulseCoefficients(duty, PULSE_HARMONICS);
    wave = ctx.createPeriodicWave(real, imag);
    byDuty.set(duty, wave);
  }
  return wave;
}

/** One period (93 states) of the NES noise channel's short-mode 15-bit LFSR as +/-1 values. */
export function shortLfsrPeriod(): number[] {
  let reg = 1;
  const out: number[] = [];
  for (let i = 0; i < 93; i++) {
    out.push(reg & 1 ? -1 : 1);
    const feedback = (reg & 1) ^ ((reg >> 6) & 1);
    reg = (reg >> 1) | (feedback << 14);
  }
  return out;
}

function buildNoise(ctx: BaseAudioContext, color: NoiseColor): AudioBuffer {
  if (color === 'white') {
    const length = Math.floor(ctx.sampleRate * WHITE_SECONDS);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
  const period = shortLfsrPeriod();
  const buffer = ctx.createBuffer(1, period.length * METAL_HOLD_SAMPLES, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  period.forEach((v, i) => data.fill(v, i * METAL_HOLD_SAMPLES, (i + 1) * METAL_HOLD_SAMPLES));
  return buffer;
}

export function noiseBuffer(ctx: BaseAudioContext, color: NoiseColor): AudioBuffer {
  let byColor = noiseCache.get(ctx);
  if (!byColor) {
    byColor = new Map();
    noiseCache.set(ctx, byColor);
  }
  let buffer = byColor.get(color);
  if (!buffer) {
    buffer = buildNoise(ctx, color);
    byColor.set(color, buffer);
  }
  return buffer;
}
