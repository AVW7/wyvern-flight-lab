#!/usr/bin/env node
/**
 * Runtime contract for the standalone rider asset.
 *
 * The rider ships as its own GLB on purpose: merging it into
 * `wyvern-v2-rig.glb` would break `runtime_rig_contract.mjs` (skin count, joint
 * count, mesh count, node TRS signature) and `test/wyvern-v2-kinetics.test.js`.
 * A separate file breaks nothing.
 *
 * What this pins, and why each item is load-bearing:
 *
 *   - bone names and count — `src/flight-lab/rider/riderMount.ts` looks them up
 *     by name; a rename silently drops a mount and the rider floats.
 *   - clip names — the runtime maps wyvern clips to rider clips by name.
 *   - tri count — the rider is drawn every frame next to a 50k-tri wyvern; an
 *     accidental subdivision would double the cost for no visible gain.
 *   - units per metre — the rider is authored in wyvern units so it inherits
 *     the wyvern's `normalizedClone` scale factor. If this drifts, the rider
 *     becomes the wrong size with no error anywhere.
 *   - orientation — +Y up, +Z forward, matching the wyvern.
 *
 *   node tools/blender/rider_runtime_contract.mjs                 validate
 *   node tools/blender/rider_runtime_contract.mjs --write         regenerate
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RIDER_PATH = fileURLToPath(new URL("../../public/models/wyvern-rider.glb", import.meta.url));
export const RIDER_CONTRACT_PATH = fileURLToPath(
  new URL("../../scripts/blender/wyvern_rider_runtime_contract.json", import.meta.url)
);

const BONE_PREFIX = "RDR_";

export function readGlb(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "glTF", "not a GLB");
  assert.equal(bytes.readUInt32LE(4), 2, "unsupported glTF version");
  assert.equal(bytes.readUInt32LE(8), bytes.length, "GLB length mismatch");
  const length = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, "first chunk is not JSON");
  const offset = 20 + length;
  return { gltf: JSON.parse(bytes.toString("utf8", 20, offset)), binary: bytes.subarray(offset + 8) };
}

/** World translation of every node, by walking the scene graph. */
function nodeWorldPositions(g) {
  const out = new Map();
  const local = (node) => {
    if (node.matrix) {
      // Column-major 4x4; translation is elements 12..14.
      return { t: [node.matrix[12], node.matrix[13], node.matrix[14]], r: null, s: [1, 1, 1] };
    }
    return { t: node.translation ?? [0, 0, 0], r: node.rotation ?? [0, 0, 0, 1], s: node.scale ?? [1, 1, 1] };
  };
  // Rotation matrices from quaternions, only for the translation chain. The
  // rider's hierarchy has no non-uniform scale, so this is exact here.
  const rotate = (q, v) => {
    const [x, y, z, w] = q;
    const ix = w * v[0] + y * v[2] - z * v[1];
    const iy = w * v[1] + z * v[0] - x * v[2];
    const iz = w * v[2] + x * v[1] - y * v[0];
    const iw = -x * v[0] - y * v[1] - z * v[2];
    return [
      ix * w + iw * -x + iy * -z - iz * -y,
      iy * w + iw * -y + iz * -x - ix * -z,
      iz * w + iw * -z + ix * -y - iy * -x,
    ];
  };
  const walk = (index, parentT, parentQ) => {
    const node = g.nodes[index];
    const { t, r } = local(node);
    const scaled = [t[0] * 1, t[1] * 1, t[2] * 1];
    const worldT = parentQ
      ? rotate(parentQ, scaled).map((v, i) => v + parentT[i])
      : scaled;
    const worldQ = r ? (parentQ ? multiply(parentQ, r) : r) : parentQ;
    if (node.name) out.set(node.name, worldT);
    for (const child of node.children ?? []) walk(child, worldT, worldQ);
  };
  const multiply = (a, b) => {
    const [ax, ay, az, aw] = a;
    const [bx, by, bz, bw] = b;
    return [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz,
    ];
  };
  for (const root of g.scenes?.[g.scene ?? 0]?.nodes ?? []) walk(root, [0, 0, 0], null);
  return out;
}

export function inspect(bytes) {
  const { gltf: g } = readGlb(bytes);
  const nodes = g.nodes ?? [];
  const boneNames = nodes.map((n) => n.name).filter((n) => n && n.startsWith(BONE_PREFIX));

  let tris = 0;
  for (const mesh of g.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const mode = primitive.mode ?? 4;
      assert.equal(mode, 4, "only triangle primitives are expected");
      if (primitive.indices !== undefined) {
        tris += (g.accessors[primitive.indices].count ?? 0) / 3;
      } else {
        tris += (g.accessors[primitive.attributes.POSITION].count ?? 0) / 3;
      }
    }
  }

  const clips = (g.animations ?? []).map((animation) => {
    let duration = 0;
    for (const sampler of animation.samplers ?? []) {
      const accessor = g.accessors[sampler.input];
      const max = accessor?.max?.[0] ?? 0;
      if (max > duration) duration = max;
    }
    return { name: animation.name, duration: Number(duration.toFixed(4)) };
  });

  const positions = nodeWorldPositions(g);
  const head = positions.get("RDR_Head");
  const pelvis = positions.get("RDR_Pelvis");
  const foot = positions.get("RDR_FootL");

  return {
    boneCount: boneNames.length,
    boneNames,
    skinCount: (g.skins ?? []).length,
    meshCount: (g.meshes ?? []).length,
    primitiveCount: (g.meshes ?? []).reduce((sum, m) => sum + (m.primitives?.length ?? 0), 0),
    triCount: Math.round(tris),
    clipCount: clips.length,
    clips,
    // Orientation is asserted geometrically, not by trusting the exporter.
    upAxis: head && pelvis && head[1] > pelvis[1] ? "+Y" : "not+Y",
    forwardAxis: foot && head && foot[2] > head[2] ? "+Z" : "not+Z",
    headWorld: head ? head.map((v) => Number(v.toFixed(2))) : null,
    pelvisWorld: pelvis ? pelvis.map((v) => Number(v.toFixed(2))) : null,
    footWorld: foot ? foot.map((v) => Number(v.toFixed(2))) : null,
  };
}

export function buildContract(bytes) {
  const report = inspect(bytes);
  return {
    contractVersion: 1,
    asset: {
      id: "wyvern-rider-runtime",
      path: "public/models/wyvern-rider.glb",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
    },
    provenance: {
      builder: "tools/blender/build_rider.py",
      validator: "tools/blender/rider_runtime_contract.mjs",
      unitsPerMetre: 400,
      unitsPerMetreDerivation:
        "Wyvern body mesh measures 4162.2 world units nose-to-tail (tools/measure-wyvern-saddle.mjs); treating that build as 10.4 m gives 400.2 u/m. Rounded to 400: body 10.4 m, shoulder height 2.67 m.",
      riderHeightMetres: 1.8,
      note: "RDR_Root carries no geometry by design; it exists so the asset has a single origin to mount.",
    },
    signature: {
      boneCount: report.boneCount,
      boneNames: report.boneNames,
      skinCount: report.skinCount,
      meshCount: report.meshCount,
      primitiveCount: report.primitiveCount,
      triCount: report.triCount,
      clipCount: report.clipCount,
      clips: report.clips,
      upAxis: report.upAxis,
      forwardAxis: report.forwardAxis,
    },
    geometry: {
      headWorld: report.headWorld,
      pelvisWorld: report.pelvisWorld,
      footWorld: report.footWorld,
    },
  };
}

export function validateRider(bytes, contract = JSON.parse(readFileSync(RIDER_CONTRACT_PATH, "utf8"))) {
  const report = inspect(bytes);
  const signature = contract.signature;
  const errors = [];

  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };

  check(report.boneCount === signature.boneCount, `bone count ${report.boneCount} != ${signature.boneCount}`);
  check(
    JSON.stringify(report.boneNames) === JSON.stringify(signature.boneNames),
    "bone names changed; riderMount looks bones up by name and will silently drop the mount"
  );
  check(report.skinCount === signature.skinCount, `skin count ${report.skinCount} != ${signature.skinCount}`);
  check(report.meshCount === signature.meshCount, `mesh count ${report.meshCount} != ${signature.meshCount}`);
  check(report.triCount === signature.triCount, `tri count ${report.triCount} != ${signature.triCount}`);
  check(
    JSON.stringify(report.clips) === JSON.stringify(signature.clips),
    `clips changed: ${JSON.stringify(report.clips)}`
  );
  check(report.upAxis === "+Y", `up axis is ${report.upAxis}`);
  check(report.forwardAxis === "+Z", `forward axis is ${report.forwardAxis}`);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const hashMatches = sha256 === contract.asset.sha256;
  if (!hashMatches) {
    errors.push(`sha256 ${sha256.slice(0, 16)} != pinned ${contract.asset.sha256.slice(0, 16)}`);
  }

  return { passed: errors.length === 0, errors, sha256, bytes: bytes.length, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = process.argv.find((a) => a.endsWith(".glb")) ?? RIDER_PATH;
  const bytes = readFileSync(path);
  if (process.argv.includes("--write")) {
    const contract = buildContract(bytes);
    writeFileSync(RIDER_CONTRACT_PATH, `${JSON.stringify(contract, null, 2)}\n`);
    console.log(`wrote ${RIDER_CONTRACT_PATH}`);
    console.log(JSON.stringify(contract.signature, null, 2));
  } else {
    const result = validateRider(bytes);
    console.log(JSON.stringify({ ...result.report, passed: result.passed, errors: result.errors }, null, 2));
    if (!result.passed) process.exit(1);
  }
}
