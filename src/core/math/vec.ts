/**
 * Minimal 3D vector and interpolation math on plain objects.
 *
 * Deliberately not THREE.Vector3: core simulations, headless balance runs,
 * and replay assertions run in pure Node without WebGL dependencies.
 * Plain objects serialize cleanly into save files without conversion steps.
 */
export interface Vec3 {
  x: number
  y: number
  z: number
}

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z })
export const clone = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z })

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s })
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z

export const lengthSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z
export const length = (a: Vec3): number => Math.sqrt(lengthSq(a))

export const distanceSq = (a: Vec3, b: Vec3): number => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}
export const distance = (a: Vec3, b: Vec3): number => Math.sqrt(distanceSq(a, b))

/** Horizontal (XZ) distance — ground units ignore altitude when picking targets. */
export const distanceFlat = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.z - b.z)

export function normalize(a: Vec3): Vec3 {
  const len = length(a)
  return len < 1e-8 ? vec() : scale(a, 1 / len)
}

/** Unit vector pointing from `from` toward `to`. Zero if coincident. */
export const direction = (from: Vec3, to: Vec3): Vec3 => normalize(sub(to, from))

export function clampLength(a: Vec3, max: number): Vec3 {
  const len = length(a)
  return len > max ? scale(a, max / len) : clone(a)
}

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
})

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v

/** Scalar linear interpolation. */
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * Frame-rate independent exponential smoothing.
 * `rate` is roughly "fraction closed per second".
 */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  current + (target - current) * (1 - Math.exp(-rate * dt))
