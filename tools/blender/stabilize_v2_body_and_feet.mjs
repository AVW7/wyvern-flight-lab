#!/usr/bin/env node
// D1: In-place root stabilization for the V2 runtime rig.
//   Pass A: flatten Body translation X/Z (glTF horizontal) on every clip that
//           drifts below the root chain; Y starts at the first key.
//   Pass B: align each grounded clip's Body Y constant so the skinned foot
//           surface sits exactly on CANONICAL_GROUND_CONTACT_PLANE_Y (-184).
//   Pass C: lift wing-shoulder trajectories in attack2/attackAir2 so the
//           membrane never dips below the foot plane (belowFt <= 0).
// Writes via the runtime contract (signature is unchanged: animation targets
// are untouched, only values), then re-pins asset sha/bytes.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { AnimationMixer, LoopOnce, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { readGlb, encodeGlb, inspectRuntimeRig, validateRuntimeRig, writeValidatedRuntimeRig } from "./runtime_rig_contract.mjs";
import { compactGlb } from "./compact_v2_glb.mjs";
import { CANONICAL_GROUND_CONTACT_PLANE_Y, footSurfaceHeight } from "../../scripts/wyvern-ground-metrics.mjs";

await MeshoptDecoder.ready;

const INPUT = process.argv[2] ?? "public/models/wyvern-v2-rig.glb";
const OUTPUT = process.argv[3] ?? INPUT;

const BODY_DRIFT_CLIPS = ["takeoff", "death", "walk", "land", "attackAir2", "attack", "hover", "dive", "glide", "speed"];
const GROUNDED = ["idle", "walk", "rest", "attack", "attack2", "breath", "land", "takeoff", "death", "scout"];
const WING_LIFT_CLIPS = ["attack2", "attackAir2"];
const FOOT_JOINTS = new Set(["L_Toes", "R_Toes", "L_Foot", "R_Foot"]);

// --- glTF-level helpers -----------------------------------------------------
function decodeFloats(gltf, binary, index) {
  const a = gltf.accessors[index];
  const v = gltf.bufferViews[a.bufferView];
  const ext = v.extensions?.EXT_meshopt_compression;
  let data = binary, offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  if (ext) {
    const d = Buffer.alloc(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(d, ext.count, ext.byteStride,
      binary.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength), ext.mode, ext.filter);
    data = d; offset = a.byteOffset ?? 0;
  }
  assert.equal(a.componentType, 5126);
  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  const stride = v.byteStride ?? ext?.byteStride ?? comps * 4;
  return { a, comps, values: Array.from({ length: a.count * comps },
    (_, i) => data.readFloatLE(offset + Math.floor(i / comps) * stride + (i % comps) * 4)) };
}

function makeAppendor(gltf, binary) {
  const chunks = [binary];
  let binLength = binary.length;
  return {
    appendFloats(values, type) {
      const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
      const count = values.length / comps;
      const buf = Buffer.alloc(values.length * 4);
      const mins = Array(comps).fill(Infinity), maxs = Array(comps).fill(-Infinity);
      values.forEach((v, i) => {
        buf.writeFloatLE(v, i * 4);
        const c = i % comps;
        if (v < mins[c]) mins[c] = v;
        if (v > maxs[c]) maxs[c] = v;
      });
      const pad = (4 - (binLength % 4)) % 4;
      if (pad) {
        chunks.push(Buffer.alloc(pad));
        binLength += pad;
      }
      gltf.bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: buf.length });
      chunks.push(buf);
      binLength += buf.length;
      gltf.accessors.push({ bufferView: gltf.bufferViews.length - 1, componentType: 5126, count, type, min: mins, max: maxs });
      return gltf.accessors.length - 1;
    },
    finish() {
      const pad = (4 - (binLength % 4)) % 4;
      if (pad) {
        chunks.push(Buffer.alloc(pad));
        binLength += pad;
      }
      gltf.buffers[0].byteLength = binLength;
      return Buffer.concat(chunks, binLength);
    },
  };
}

const nodeName = (gltf, i) => gltf.nodes[i].name;
function findChannel(gltf, anim, bone, path) {
  return anim.channels.find(c => nodeName(gltf, c.target.node) === bone && c.target.path === path);
}

// --- three.js evaluation context ---------------------------------------------
async function loadScene(bytes) {
  const { gltf, binary } = readGlb(bytes);
  for (const m of gltf.meshes ?? []) for (const p of m.primitives ?? []) delete p.material;
  delete gltf.materials; delete gltf.images; delete gltf.textures; delete gltf.samplers;
  const stripped = encodeGlb(gltf, binary);
  const { scene, animations } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength), "");
  const bones = new Map();
  scene.traverse(o => { if (o.isBone) bones.set(o.name, o); });
  const footMeshes = [];
  scene.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
    const names = o.skeleton.bones.map(b => b.name);
    const indices = [];
    for (let v = 0; v < si.count; v++) {
      let w = 0;
      for (let c = 0; c < 4; c++) if (FOOT_JOINTS.has(names[si.getComponent(v, c)])) w += sw.getComponent(v, c);
      if (w > 0.5) indices.push(v);
    }
    if (indices.length) footMeshes.push({ mesh: o, indices });
  });
  const mixer = new AnimationMixer(scene);
  const poseAt = (clip, time) => {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset().play();
    action.time = time;
    mixer.update(0);
    scene.updateMatrixWorld(true);
  };
  return { scene, animations, bones, footMeshes, poseAt };
}

// === Load + Pass A: flatten Body X/Z (and Y to first key) ====================
let bytes = readFileSync(INPUT);
{
  const { gltf, binary } = readGlb(bytes);
  const app = makeAppendor(gltf, binary);
  for (const clipName of BODY_DRIFT_CLIPS) {
    const anim = gltf.animations.find(a => a.name === clipName);
    assert.ok(anim, `missing clip ${clipName}`);
    const ch = findChannel(gltf, anim, "Body", "translation");
    if (!ch) continue;
    const sampler = anim.samplers[ch.sampler];
    const { a, values } = decodeFloats(gltf, binary, sampler.output);
    const [x0, y0, z0] = values;
    const flat = [];
    for (let k = 0; k < a.count; k++) flat.push(x0, y0, z0);
    sampler.output = app.appendFloats(flat, "VEC3");
    console.log(`[D1-A] ${clipName}: Body translation flattened to [${x0.toFixed(1)}, ${y0.toFixed(1)}, ${z0.toFixed(1)}]`);
  }
  bytes = encodeGlb(gltf, app.finish());
}

// === Pass B: per-clip Body Y alignment to the canonical floor ================
{
  const { gltf, binary } = readGlb(bytes);
  const app = makeAppendor(gltf, binary);
  const ctx = await loadScene(bytes);
  for (const clipName of GROUNDED) {
    const clip = ctx.animations.find(a => a.name === clipName);
    if (!clip || !ctx.footMeshes.length) continue;
    const footY = footSurfaceHeight({ poseAt: t => ctx.poseAt(clip, t), footMeshes: ctx.footMeshes, duration: clip.duration, frames: 24 });
    const shift = CANONICAL_GROUND_CONTACT_PLANE_Y - footY;
    const anim = gltf.animations.find(a => a.name === clipName);
    const ch = findChannel(gltf, anim, "Body", "translation");
    assert.ok(ch, `${clipName} has no Body translation track`);
    const sampler = anim.samplers[ch.sampler];
    const { a, values } = decodeFloats(gltf, binary, sampler.output);
    const out = [];
    for (let k = 0; k < a.count; k++) out.push(values[k * 3], values[k * 3 + 1] + shift, values[k * 3 + 2]);
    sampler.output = app.appendFloats(out, "VEC3");
    console.log(`[D1-B] ${clipName}: footY ${footY.toFixed(1)} -> ${(footY + shift).toFixed(1)} (Body Y ${shift >= 0 ? "+" : ""}${shift.toFixed(1)})`);
  }
  bytes = encodeGlb(gltf, app.finish());
}

// === Pass C: wing-lift for attack2/attackAir2 ================================
{
  const { gltf, binary } = readGlb(bytes);
  const app = makeAppendor(gltf, binary);
  const ctx = await loadScene(bytes);
  const membrane = [];
  ctx.scene.traverse(o => { if (o.isSkinnedMesh && o.name.includes("Membrane")) membrane.push(o); });
  const vertex = new Vector3();
  for (const clipName of WING_LIFT_CLIPS) {
    const clip = ctx.animations.find(a => a.name === clipName);
    if (!clip) continue;
    const anim = gltf.animations.find(a => a.name === clipName);
    const frames = 48;
    const corrections = { L: new Array(frames).fill(0), R: new Array(frames).fill(0) };
    let worstBefore = -Infinity, worstAfter = -Infinity;
    for (let iter = 0; iter < 8; iter++) {
      let residual = 0;
      for (let f = 0; f < frames; f++) {
        const t = (f / (frames - 1)) * clip.duration;
        ctx.poseAt(clip, t);
        // Apply corrections accumulated so far this pass
        for (const side of ["L", "R"]) {
          const shoulder = ctx.bones.get(`${side}_WingShoulder`);
          if (corrections[side][f] !== 0) {
            shoulder.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), corrections[side][f]));
            shoulder.updateMatrix();
            ctx.scene.updateMatrixWorld(true);
          }
        }
        let minWingY = Infinity;
        for (const mesh of membrane) {
          const pos = mesh.geometry.attributes.position;
          for (let v = 0; v < pos.count; v += 3) {
            vertex.fromBufferAttribute(pos, v);
            mesh.applyBoneTransform(v, vertex);
            vertex.applyMatrix4(mesh.matrixWorld);
            if (vertex.y < minWingY) minWingY = vertex.y;
          }
        }
        const pen = CANONICAL_GROUND_CONTACT_PLANE_Y - minWingY;
        if (iter === 0) worstBefore = Math.max(worstBefore, pen);
        if (pen <= 0) continue;
        // Numerical gradient: nudge both shoulders about local X, measure lift
        for (const side of ["L", "R"]) {
          const shoulder = ctx.bones.get(`${side}_WingShoulder`);
          const q0 = shoulder.quaternion.clone();
          shoulder.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.005));
          ctx.scene.updateMatrixWorld(true);
          let liftedMin = Infinity;
          for (const mesh of membrane) {
            const pos = mesh.geometry.attributes.position;
            for (let v = 0; v < pos.count; v += 6) {
              vertex.fromBufferAttribute(pos, v);
              mesh.applyBoneTransform(v, vertex);
              vertex.applyMatrix4(mesh.matrixWorld);
              if (vertex.y < liftedMin) liftedMin = vertex.y;
            }
          }
          shoulder.quaternion.copy(q0);
          shoulder.updateMatrix();
          const dydtheta = liftedMin - minWingY; // per 0.005 rad
          if (dydtheta <= 1e-6) continue;
          const delta = Math.min(0.6, pen / (dydtheta / 0.005));
          corrections[side][f] += delta;
        }
        residual = Math.max(residual, pen);
      }
      if (residual <= 0.5) break;
    }
    // Re-measure with final corrections
    for (let f = 0; f < frames; f++) {
      const t = (f / (frames - 1)) * clip.duration;
      ctx.poseAt(clip, t);
      for (const side of ["L", "R"]) {
        const shoulder = ctx.bones.get(`${side}_WingShoulder`);
        if (corrections[side][f] !== 0) {
          shoulder.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), corrections[side][f]));
          shoulder.updateMatrix();
          ctx.scene.updateMatrixWorld(true);
        }
      }
      let minWingY = Infinity;
      for (const mesh of membrane) {
        const pos = mesh.geometry.attributes.position;
        for (let v = 0; v < pos.count; v++) {
          vertex.fromBufferAttribute(pos, v);
          mesh.applyBoneTransform(v, vertex);
          vertex.applyMatrix4(mesh.matrixWorld);
          if (vertex.y < minWingY) minWingY = vertex.y;
        }
      }
      worstAfter = Math.max(worstAfter, CANONICAL_GROUND_CONTACT_PLANE_Y - minWingY);
    }
    console.log(`[D1-C] ${clipName}: below-foot penetration ${worstBefore.toFixed(1)} -> ${worstAfter.toFixed(1)} rig units`);

    // Bake corrections into the shoulder rotation tracks (nearest frame key)
    for (const side of ["L", "R"]) {
      const ch = findChannel(gltf, anim, `${side}_WingShoulder`, "rotation");
      if (!ch) continue;
      const sampler = anim.samplers[ch.sampler];
      const times = decodeFloats(gltf, binary, sampler.input).values;
      const { a, values } = decodeFloats(gltf, binary, sampler.output);
      const out = [...values];
      const scratch = new Quaternion();
      for (let k = 0; k < a.count; k++) {
        const f = Math.round((times[k] / clip.duration) * (frames - 1));
        const corr = corrections[side][f];
        if (corr === 0) continue;
        scratch.set(out[k * 4], out[k * 4 + 1], out[k * 4 + 2], out[k * 4 + 3])
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), corr));
        out[k * 4] = scratch.x; out[k * 4 + 1] = scratch.y; out[k * 4 + 2] = scratch.z; out[k * 4 + 3] = scratch.w;
      }
      sampler.output = app.appendFloats(out, "VEC4");
    }
  }
  bytes = encodeGlb(gltf, app.finish());
}

// === Write through the contract ==============================================
const tmp = `${OUTPUT}.d1.tmp`;
writeFileSync(tmp, bytes);
try {
  compactGlb(tmp, tmp); // signature unchanged (targets only); validates against contract
  const finalBytes = readFileSync(tmp);
  const isRuntimePath = resolve(OUTPUT) === resolve("public/models/wyvern-v2-rig.glb");
  if (isRuntimePath) {
    const contractPath = "scripts/blender/wyvern_v2_runtime_contract.json";
    const contract = JSON.parse(readFileSync(contractPath, "utf8"));
    contract.asset.sha256 = createHash("sha256").update(finalBytes).digest("hex");
    contract.asset.bytes = finalBytes.length;
    writeFileSync(contractPath, JSON.stringify(contract, null, 2) + "\n");
  }
  writeValidatedRuntimeRig(OUTPUT, finalBytes);
  console.log(`[D1] Wrote ${OUTPUT}: ${JSON.stringify(validateRuntimeRig(readFileSync(OUTPUT), { checkHash: isRuntimePath }))}`);
} finally {
  rmSync(tmp, { force: true });
}
