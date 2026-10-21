/** Provisional V1-inspired aerodynamic envelopes, not measured donor extracts.
 * Actual baked performance and source provenance live in the harvest candidate manifest.
 */

/** Cyclic smoothstep evaluator over cyclic phase [0, 1]. */
function sampleCyclicTable(table: readonly number[], phase: number): number {
  const n = table.length;
  const wrapped = ((phase % 1.0) + 1.0) % 1.0;
  const pos = wrapped * n;
  const i0 = Math.floor(pos) % n;
  const i1 = (i0 + 1) % n;
  const frac = pos - Math.floor(pos);
  // Smooth cubic hermite interpolation
  const s = frac * frac * (3 - 2 * frac);
  const v0 = table[i0] ?? 0;
  const v1 = table[i1] ?? 0;
  return v0 * (1 - s) + v1 * s;
}

/**
 * 24-point normalized wing elevation curve over 1 full wingbeat cycle (phase 0..1).
 * Authored approximation; extraction fidelity has not been established.
 * Peak downstroke elevation at ~0.35, lowest bottom at ~0.55, progressive recovery up to 1.0.
 */
export const V1_CRUISE_ELEVATION_PROFILE: readonly number[] = [
  0.82, 0.94, 1.00, 0.95, 0.78, 0.45, 0.05, -0.42, -0.80, -0.98, -1.00, -0.85,
  -0.60, -0.32, -0.05, 0.18, 0.38, 0.54, 0.65, 0.72, 0.76, 0.78, 0.79, 0.80,
];

/**
 * 24-point normalized wing sweep curve (forward on downstroke, swept back on upstroke).
 */
export const V1_CRUISE_SWEEP_PROFILE: readonly number[] = [
  0.10, 0.25, 0.42, 0.55, 0.50, 0.30, 0.05, -0.25, -0.55, -0.80, -0.95, -1.00,
  -0.90, -0.75, -0.55, -0.35, -0.15, 0.00, 0.10, 0.15, 0.14, 0.12, 0.10, 0.10,
];

/**
 * 24-point angle of attack twist curve (positive pitch during downstroke, negative feathering during upstroke).
 */
export const V1_CRUISE_TWIST_PROFILE: readonly number[] = [
  0.15, 0.35, 0.58, 0.75, 0.85, 0.80, 0.60, 0.20, -0.30, -0.70, -0.92, -1.00,
  -0.90, -0.70, -0.45, -0.20, -0.02, 0.10, 0.18, 0.22, 0.20, 0.18, 0.16, 0.15,
];

/** Phase offsets for digits D0..D5 creating natural trailing aerodynamic flutter wave. */
export const V1_DIGIT_PHASE_OFFSETS: readonly number[] = [
  0.00,  // D0 (leading edge bone, rigid spar)
  0.06,  // D1
  0.12,  // D2
  0.18,  // D3
  0.24,  // D4
  0.30,  // D5 (trailing edge tip, highest compliant lag)
];

/** Phase offsets for membrane panel battens Panel0..Panel3. */
export const V1_PANEL_PHASE_OFFSETS: readonly number[] = [
  0.08,  // Panel0
  0.15,  // Panel1
  0.22,  // Panel2
  0.28,  // Panel3
];

/**
 * Sample harvested wing elevation angle in radians for a given wingbeat phase [0, 1].
 * @param phase Normalized cycle phase [0, 1].
 * @param strokeAmplitude Maximum stroke angle in radians (default ~0.45 rad / ~26 deg).
 */
export function sampleHarvestedElevation(phase: number, strokeAmplitude = 0.45): number {
  return sampleCyclicTable(V1_CRUISE_ELEVATION_PROFILE, phase) * strokeAmplitude;
}

/**
 * Sample harvested wing sweep angle in radians for a given wingbeat phase [0, 1].
 * @param phase Normalized cycle phase [0, 1].
 * @param sweepAmplitude Maximum sweep angle in radians (default ~0.15 rad).
 */
export function sampleHarvestedSweep(phase: number, sweepAmplitude = 0.15): number {
  return sampleCyclicTable(V1_CRUISE_SWEEP_PROFILE, phase) * sweepAmplitude;
}

/**
 * Sample harvested wing angle-of-attack twist in radians.
 * @param phase Normalized cycle phase [0, 1].
 * @param twistAmplitude Maximum twist angle in radians (default ~0.18 rad).
 */
export function sampleHarvestedTwist(phase: number, twistAmplitude = 0.18): number {
  return sampleCyclicTable(V1_CRUISE_TWIST_PROFILE, phase) * twistAmplitude;
}

/**
 * Sample trailing-edge digit aerodynamic curl for digit D0..D5.
 * @param digitIndex 0 to 5.
 * @param phase Normalized cycle phase [0, 1].
 * @param baseAmplitude Base flutter amplitude.
 */
export function sampleHarvestedDigitCurl(digitIndex: number, phase: number, baseAmplitude = 0.05): number {
  const clampedIndex = Math.max(0, Math.min(5, digitIndex));
  const lag = V1_DIGIT_PHASE_OFFSETS[clampedIndex] ?? 0;
  const laggedPhase = phase - lag;
  // Trailing digits flex with greater amplitude than leading digits
  const amplitudeMultiplier = 0.4 + (clampedIndex / 5.0) * 0.9;
  return sampleCyclicTable(V1_CRUISE_TWIST_PROFILE, laggedPhase) * baseAmplitude * amplitudeMultiplier;
}

/**
 * Sample membrane panel batten flex for Panel0..Panel3.
 * @param panelIndex 0 to 3.
 * @param phase Normalized cycle phase [0, 1].
 * @param baseAmplitude Base flutter amplitude.
 */
export function sampleHarvestedPanelFlex(panelIndex: number, phase: number, baseAmplitude = 0.04): number {
  const clampedIndex = Math.max(0, Math.min(3, panelIndex));
  const lag = V1_PANEL_PHASE_OFFSETS[clampedIndex] ?? 0;
  const laggedPhase = phase - lag;
  const amplitudeMultiplier = 0.5 + (clampedIndex / 3.0) * 0.8;
  return sampleCyclicTable(V1_CRUISE_ELEVATION_PROFILE, laggedPhase) * baseAmplitude * amplitudeMultiplier;
}
