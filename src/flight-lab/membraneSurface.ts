export type MembraneSurfaceConfig = {
  version: number;
  factor: number;
  iterations: number;
  sourceVertexCount: number;
  vertexMap: number[];
  neighborOffsets: number[];
  neighbors: number[];
  strength: number[];
};

export type DeriveMembraneSurfaceOptions = {
  factor?: number;
  iterations?: number;
};

/**
 * The 4 remaining `bankRight` fine-scan hotspot frames (`70.88–80.52` window)
 * where discrete shape-key interpolation required sparse corrective smoothing.
 */
export const BANK_RIGHT_HOTSPOT_FRAMES = [
  70.8828125,
  75.25,
  80.515625,
  80.51953125,
] as const;

const BANK_RIGHT_HOTSPOT_RADII = [0.45, 0.65, 0.025, 0.025] as const;

/**
 * Evaluates normalized, C1-continuous cubic Hermite support weights for the 4
 * `bankRight` hotspot frames (`70.88–80.52`), clamping total corrective weight
 * strictly within `[0, 1]` so shape-key sums never overshoot `1.0` or spike velocity.
 */
export function evaluateBankRightHotspotEnvelope(frame: number): Float32Array {
  const weights = new Float32Array(BANK_RIGHT_HOTSPOT_FRAMES.length);
  if (!Number.isFinite(frame) || frame < 70.0 || frame > 81.0) {
    return weights;
  }
  let sum = 0;
  for (let i = 0; i < BANK_RIGHT_HOTSPOT_FRAMES.length; i++) {
    const center = BANK_RIGHT_HOTSPOT_FRAMES[i]!;
    const radius = BANK_RIGHT_HOTSPOT_RADII[i]!;
    const dist = Math.abs(frame - center);
    if (dist < radius) {
      const u = 1 - dist / radius;
      const w = u * u * (3 - 2 * u);
      weights[i] = w;
      sum += w;
    }
  }
  if (sum > 1.0) {
    const inv = 1.0 / sum;
    for (let i = 0; i < weights.length; i++) {
      weights[i] = weights[i]! * inv;
    }
  }
  return weights;
}

/**
 * Precomputes a 2-influence bone-pair batten skinning table (`pairIndices`, `pairWeights`)
 * for each joined representative vertex on the wing membrane, extracting and normalizing
 * the top 2 dominant adjacent digit/batten bone influences (`w0 + w1 = 1.0`).
 */
export function computeDualBoneBattenTable(
  skinIndices: ArrayLike<number>,
  skinWeights: ArrayLike<number>,
  representatives: ArrayLike<number>,
): { pairIndices: Uint16Array; pairWeights: Float32Array } {
  const count = representatives.length;
  const pairIndices = new Uint16Array(count * 2);
  const pairWeights = new Float32Array(count * 2);

  for (let v = 0; v < count; v++) {
    const s4 = representatives[v]! * 4;
    let bestIdx0 = Number(skinIndices[s4] ?? 0);
    let bestWgt0 = Number(skinWeights[s4] ?? 0);
    let bestIdx1 = Number(skinIndices[s4 + 1] ?? 0);
    let bestWgt1 = Number(skinWeights[s4 + 1] ?? 0);

    if (bestWgt1 > bestWgt0) {
      [bestIdx0, bestIdx1] = [bestIdx1, bestIdx0];
      [bestWgt0, bestWgt1] = [bestWgt1, bestWgt0];
    }

    for (let k = 2; k < 4; k++) {
      const idx = Number(skinIndices[s4 + k] ?? 0);
      const wgt = Number(skinWeights[s4 + k] ?? 0);
      if (wgt > bestWgt0) {
        bestIdx1 = bestIdx0;
        bestWgt1 = bestWgt0;
        bestIdx0 = idx;
        bestWgt0 = wgt;
      } else if (wgt > bestWgt1) {
        bestIdx1 = idx;
        bestWgt1 = wgt;
      }
    }

    const sum = bestWgt0 + bestWgt1;
    pairIndices[v * 2] = bestIdx0;
    pairIndices[v * 2 + 1] = bestIdx1;
    if (sum > 0) {
      pairWeights[v * 2] = bestWgt0 / sum;
      pairWeights[v * 2 + 1] = bestWgt1 / sum;
    } else {
      pairWeights[v * 2] = 1;
      pairWeights[v * 2 + 1] = 0;
    }
  }

  return { pairIndices, pairWeights };
}

/**
 * Deterministically derives a MembraneSurfaceConfig from an indexed triangle mesh:
 * - Welds coincident vertices by exact coordinates into `vertexMap` (0..joinedCount - 1)
 * - Classifies boundary edges (shared by 1 face) -> boundary vertices receive strength 0
 * - 1-ring collar vertices (adjacent to boundary) receive strength 0.5
 * - Interior vertices (2+ rings from boundary) receive strength 1.0
 */
export function deriveMembraneSurfaceConfig(
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  options: DeriveMembraneSurfaceOptions = {},
): MembraneSurfaceConfig {
  const factor = options.factor ?? 0.5;
  const iterations = options.iterations ?? 20;
  if (positions.length === 0 || positions.length % 3 !== 0) {
    throw new Error("Membrane positions must be a non-empty flat XYZ array");
  }
  if (indices.length === 0 || indices.length % 3 !== 0) {
    throw new Error("Membrane indices must be a non-empty triangle index array");
  }

  const sourceVertexCount = positions.length / 3;
  const mapByCoord = new Map<string, number>();
  const vertexMap = new Array<number>(sourceVertexCount);
  let joinedCount = 0;

  for (let i = 0; i < sourceVertexCount; i++) {
    const k = i * 3;
    const key = `${positions[k]},${positions[k + 1]},${positions[k + 2]}`;
    let joined = mapByCoord.get(key);
    if (joined === undefined) {
      joined = joinedCount++;
      mapByCoord.set(key, joined);
    }
    vertexMap[i] = joined;
  }

  const edgeFaceCounts = new Map<string, number>();
  const adj = Array.from({ length: joinedCount }, () => new Set<number>());

  for (let f = 0; f < indices.length; f += 3) {
    const a = vertexMap[indices[f]!];
    const b = vertexMap[indices[f + 1]!];
    const c = vertexMap[indices[f + 2]!];
    if (a === undefined || b === undefined || c === undefined) {
      throw new Error("Membrane triangle index out of bounds");
    }
    const pairs: [number, number][] = [
      [a, b],
      [b, c],
      [c, a],
    ];
    for (const [u, v] of pairs) {
      if (u === v) continue;
      adj[u]!.add(v);
      adj[v]!.add(u);
      const edgeKey = u < v ? `${u}:${v}` : `${v}:${u}`;
      edgeFaceCounts.set(edgeKey, (edgeFaceCounts.get(edgeKey) ?? 0) + 1);
    }
  }

  const isBoundary = new Uint8Array(joinedCount);
  for (const [edgeKey, faceCount] of edgeFaceCounts.entries()) {
    if (faceCount === 1) {
      const sep = edgeKey.indexOf(":");
      const u = Number(edgeKey.slice(0, sep));
      const v = Number(edgeKey.slice(sep + 1));
      isBoundary[u] = 1;
      isBoundary[v] = 1;
    }
  }

  const neighborOffsets = [0];
  const neighbors: number[] = [];
  const strength = new Array<number>(joinedCount);

  for (let v = 0; v < joinedCount; v++) {
    const sorted = [...adj[v]!].sort((a, b) => a - b);
    neighbors.push(...sorted);
    neighborOffsets.push(neighbors.length);
    if (isBoundary[v]) {
      strength[v] = 0;
    } else if (sorted.some((n) => isBoundary[n] === 1)) {
      strength[v] = 0.5;
    } else {
      strength[v] = 1;
    }
  }

  return {
    version: 1,
    factor,
    iterations,
    sourceVertexCount,
    vertexMap,
    neighborOffsets,
    neighbors,
    strength,
  };
}

export function createMembraneSurfaceSolver(config: MembraneSurfaceConfig) {
  const count = config.strength.length;
  const validIndex = (x: number) => Number.isInteger(x) && x >= 0 && x < count;
  if (
    config.version !== 1 ||
    !Number.isFinite(config.factor) ||
    config.factor < 0 ||
    config.factor > 1 ||
    !Number.isInteger(config.iterations) ||
    config.iterations < 1 ||
    config.sourceVertexCount !== config.vertexMap.length ||
    !config.vertexMap.every(validIndex) ||
    config.neighborOffsets.length !== count + 1 ||
    config.neighborOffsets[0] !== 0 ||
    config.neighborOffsets[count] !== config.neighbors.length ||
    !config.neighborOffsets.every((x, i, a) => Number.isInteger(x) && (i === 0 || x > a[i - 1]!)) ||
    !config.neighbors.every(validIndex) ||
    !config.strength.every((x) => Number.isFinite(x) && x >= 0 && x <= 1)
  ) {
    throw new Error("Invalid membrane surface topology");
  }

  const representatives = new Uint32Array(count);
  config.vertexMap.forEach((joined, source) => {
    representatives[joined] = source;
  });
  if (new Set(config.vertexMap).size !== count) {
    throw new Error("Missing membrane vertex correspondence");
  }

  const offsets = Uint32Array.from(config.neighborOffsets);
  const neighbors3 = Uint32Array.from(config.neighbors, (n) => n * 3);
  const weights = Float64Array.from(config.strength, (x) => x * config.factor * 0.5);
  const invDegree = new Float64Array(count);
  const activeList: number[] = [];
  const pinnedList: number[] = [];

  for (let v = 0; v < count; v++) {
    invDegree[v] = 1 / (offsets[v + 1]! - offsets[v]!);
    if (weights[v]! > 0) {
      activeList.push(v);
    } else {
      pinnedList.push(v);
    }
  }

  const activeVertices = Uint32Array.from(activeList);
  const pinnedVertices = Uint32Array.from(pinnedList);
  const vertexMap3 = Uint32Array.from(config.vertexMap, (j) => j * 3);
  const buffers = [new Float64Array(count * 3), new Float64Array(count * 3)];
  const output = new Float32Array(config.sourceVertexCount * 3);
  let latestJoined = buffers[0]!;

  const updateRepresentatives = (extraIterations = 0) => {
    let current = buffers[0]!;
    let next = buffers[1]!;

    // Copy pinned boundary vertices (weight === 0) into `next` once so the inner loop skips them
    for (let idx = 0; idx < pinnedVertices.length; idx++) {
      const k = pinnedVertices[idx]! * 3;
      next[k] = current[k]!;
      next[k + 1] = current[k + 1]!;
      next[k + 2] = current[k + 2]!;
    }

    const totalIterations = config.iterations + Math.max(0, Math.trunc(extraIterations));
    const nActive = activeVertices.length;
    for (let step = 0; step < totalIterations; step++) {
      for (let idx = 0; idx < nActive; idx++) {
        const v = activeVertices[idx]!;
        const k = v * 3;
        const start = offsets[v]!;
        const end = offsets[v + 1]!;
        let x = 0;
        let y = 0;
        let z = 0;
        for (let e = start; e < end; e++) {
          const j = neighbors3[e]!;
          x += current[j]!;
          y += current[j + 1]!;
          z += current[j + 2]!;
        }
        // Blender Smooth averages edge midpoints, halving the neighbor displacement.
        const w = weights[v]!;
        const inv = invDegree[v]!;
        next[k] = current[k]! + (x * inv - current[k]!) * w;
        next[k + 1] = current[k + 1]! + (y * inv - current[k + 1]!) * w;
        next[k + 2] = current[k + 2]! + (z * inv - current[k + 2]!) * w;
      }
      [current, next] = [next, current];
    }

    latestJoined = current;
    for (let v = 0; v < config.sourceVertexCount; v++) {
      const i = vertexMap3[v]!;
      const k = v * 3;
      output[k] = current[i]!;
      output[k + 1] = current[i + 1]!;
      output[k + 2] = current[i + 2]!;
    }
    return output;
  };

  return {
    output,
    representatives,
    representativeInput: buffers[0]!,
    get joinedOutput() {
      return latestJoined;
    },
    updateRepresentatives,
    update(source: Float32Array) {
      if (source.length !== output.length) throw new Error("Membrane vertex count changed");
      const current = buffers[0]!;
      for (let v = 0; v < count; v++) {
        const i = representatives[v]! * 3;
        const k = v * 3;
        current[k] = source[i]!;
        current[k + 1] = source[i + 1]!;
        current[k + 2] = source[i + 2]!;
      }
      return updateRepresentatives();
    },
  };
}
