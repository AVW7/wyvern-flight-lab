import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { AnimationMixer, Euler, LoopOnce, Matrix4, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { readGlb, encodeGlb, inspectRuntimeRig, validateRuntimeRig, writeValidatedRuntimeRig } from "./runtime_rig_contract.mjs";
import { compactGlb } from "./compact_v2_glb.mjs";
import { smoothSelectedWeights } from "./local_membrane_weights.mjs";
import { PANEL_NAMES } from "./package_panel_coordination.mjs";
import { measureCreases, triangleEdges } from "../membrane-crease-metrics.mjs";

await MeshoptDecoder.ready;

const DIGIT_NAMES = ["L", "R"].flatMap((s) =>
  [0, 1, 2, 3, 4, 5].flatMap((d) => [0, 1, 2].map((p) => `${s}_WingD${d}P${p}`))
);
const WING_ARM_NAMES = ["L", "R"].flatMap((s) =>
  ["WingRoot", "WingShoulder", "WingElbow", "WingWrist", "WingHand"].map((p) => `${s}_${p}`)
);
const WING_CHAIN_NAMES = [...WING_ARM_NAMES, ...DIGIT_NAMES];
const NECK_HEAD_NAMES = ["Neck1", "Neck2", "Head"];

function decodeAccessor(gltf, binary, index, cache = new Map()) {
  const a = gltf.accessors[index];
  const v = gltf.bufferViews[a.bufferView];
  const ext = v.extensions?.EXT_meshopt_compression;
  let data = binary;
  let offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  if (ext) {
    if (!cache.has(a.bufferView)) {
      const decoded = Buffer.alloc(ext.count * ext.byteStride);
      MeshoptDecoder.decodeGltfBuffer(
        decoded,
        ext.count,
        ext.byteStride,
        binary.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength),
        ext.mode,
        ext.filter
      );
      cache.set(a.bufferView, decoded);
    }
    data = cache.get(a.bufferView);
    offset = a.byteOffset ?? 0;
  }
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type];
  const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
  const method = {
    5120: "readInt8",
    5121: "readUInt8",
    5122: "readInt16LE",
    5123: "readUInt16LE",
    5125: "readUInt32LE",
    5126: "readFloatLE",
  }[a.componentType];
  const stride = v.byteStride ?? ext?.byteStride ?? components * size;
  const scale = a.normalized
    ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[a.componentType]
    : 1;
  return Array.from({ length: a.count }, (_, i) =>
    Array.from({ length: components }, (_, k) => {
      const raw = data[method](offset + i * stride + k * size);
      return a.normalized ? Math.max(-1, raw / scale) : raw;
    })
  );
}

/**
 * 1. Welds the 356 coincident UV-seam vertex normals in `WyvernMembrane_ExportSafe`
 *    using area-weighted face normals across the welded 7,893-vertex topology.
 * 2. Smooths skin weights (`WEIGHTS_0`) in acute inner-elbow/axilla (`WingShoulder`/`WingElbow`/`Spine3`/`Body`)
 *    and adjacent digit crease pockets (`blend = 0.28`), preserving exact seam equivalence and 4-influence normalization.
 */
function weldMembraneNormalsAndSmoothAxillaWeights(gltf, binary, appendRawBufferView) {
  const memMesh = gltf.meshes.find((m) => m.name === "SKM_DaenerysDragon.002");
  assert.ok(memMesh, "Missing SKM_DaenerysDragon.002 membrane mesh");
  const prim = memMesh.primitives[0];
  const cache = new Map();

  const positions = decodeAccessor(gltf, binary, prim.attributes.POSITION, cache);
  const normals = decodeAccessor(gltf, binary, prim.attributes.NORMAL, cache);
  const joints = decodeAccessor(gltf, binary, prim.attributes.JOINTS_0, cache);
  const weights = decodeAccessor(gltf, binary, prim.attributes.WEIGHTS_0, cache);
  const indices = decodeAccessor(gltf, binary, prim.indices, cache).flat();

  const posGroups = new Map();
  positions.forEach((p, i) => {
    const key = p.join(",");
    if (!posGroups.has(key)) posGroups.set(key, []);
    posGroups.get(key).push(i);
  });

  const accumNormals = positions.map(() => [0, 0, 0]);
  for (let f = 0; f < indices.length; f += 3) {
    const ia = indices[f], ib = indices[f + 1], ic = indices[f + 2];
    const pa = positions[ia], pb = positions[ib], pc = positions[ic];
    const ax = pb[0] - pa[0], ay = pb[1] - pa[1], az = pb[2] - pa[2];
    const bx = pc[0] - pa[0], by = pc[1] - pa[1], bz = pc[2] - pa[2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    for (const idx of [ia, ib, ic]) {
      accumNormals[idx][0] += nx;
      accumNormals[idx][1] += ny;
      accumNormals[idx][2] += nz;
    }
  }

  const normalBuf = Buffer.alloc(positions.length * 4);
  let weldedSeamPairs = 0;
  for (const group of posGroups.values()) {
    if (group.length > 1) weldedSeamPairs++;
    let gx = 0, gy = 0, gz = 0;
    for (const idx of group) {
      gx += accumNormals[idx][0];
      gy += accumNormals[idx][1];
      gz += accumNormals[idx][2];
    }
    let len = Math.hypot(gx, gy, gz);
    if (len < 1e-12) {
      const n0 = normals[group[0]];
      gx = n0[0]; gy = n0[1]; gz = n0[2];
      len = Math.hypot(gx, gy, gz) || 1;
    }
    let qx = Math.max(-127, Math.min(127, Math.round((gx / len) * 127)));
    let qy = Math.max(-127, Math.min(127, Math.round((gy / len) * 127)));
    let qz = Math.max(-127, Math.min(127, Math.round((gz / len) * 127)));
    if (qx === 0 && qy === 0 && qz === 0) qz = 127;
    for (const idx of group) {
      normalBuf.writeInt8(qx, idx * 4);
      normalBuf.writeInt8(qy, idx * 4 + 1);
      normalBuf.writeInt8(qz, idx * 4 + 2);
      normalBuf.writeInt8(0, idx * 4 + 3);
    }
  }

  const skinJointNames = gltf.skins[0].joints.map((ni) => gltf.nodes[ni].name);
  const selected = new Set();
  for (let i = 0; i < positions.length; i++) {
    let hasBodyOrSpine = false;
    let hasWingArm = false;
    for (let k = 0; k < 4; k++) {
      if (weights[i][k] <= 0.01) continue;
      const bname = skinJointNames[joints[i][k]];
      if (bname === "Body" || bname.startsWith("Spine")) hasBodyOrSpine = true;
      if (bname.includes("WingShoulder") || bname.includes("WingElbow") || bname.includes("WingRoot")) {
        hasWingArm = true;
      }
    }
    if (hasBodyOrSpine && hasWingArm) {
      selected.add(i);
    }
  }

  const edges = triangleEdges(indices);
  const restCreases = measureCreases(positions, indices, edges);
  for (const edge of restCreases.worstEdges) {
    for (const vi of edge.vertices) selected.add(vi);
  }

  let smoothedWeights = smoothSelectedWeights(positions, indices, joints, weights, selected, 0.28);
  smoothedWeights = smoothSelectedWeights(positions, indices, joints, smoothedWeights, selected, 0.22);

  const weightBuf = Buffer.alloc(positions.length * 4);
  for (let i = 0; i < smoothedWeights.length; i++) {
    const w = smoothedWeights[i];
    const q = w.map((v) => Math.max(0, Math.min(255, Math.round(v * 255))));
    const sum = q[0] + q[1] + q[2] + q[3];
    const diff = 255 - sum;
    if (diff !== 0) {
      let maxSlot = 0;
      for (let k = 1; k < 4; k++) if (q[k] > q[maxSlot]) maxSlot = k;
      q[maxSlot] = Math.max(0, Math.min(255, q[maxSlot] + diff));
    }
    for (let k = 0; k < 4; k++) {
      weightBuf.writeUInt8(q[k], i * 4 + k);
    }
  }

  const normBvIdx = appendRawBufferView(normalBuf, 4);
  const normAccIdx = gltf.accessors.length;
  gltf.accessors.push({
    bufferView: normBvIdx,
    componentType: 5120,
    normalized: true,
    count: positions.length,
    type: "VEC3",
  });
  prim.attributes.NORMAL = normAccIdx;

  const wgtBvIdx = appendRawBufferView(weightBuf);
  const wgtAccIdx = gltf.accessors.length;
  gltf.accessors.push({
    bufferView: wgtBvIdx,
    componentType: 5121,
    normalized: true,
    count: positions.length,
    type: "VEC4",
  });
  prim.attributes.WEIGHTS_0 = wgtAccIdx;

  return {
    totalVertices: positions.length,
    uniquePositions: posGroups.size,
    weldedSeamPairs,
    axillaSmoothedVertices: selected.size,
  };
}

export async function upgradeV2RigGroundAndMembrane(
  basePath = "public/models/wyvern-v2-rig.glb",
  sourcePath = "assets/harvest-candidates/2026-10-07/mcp-study/wyvern-v2-flight-panels-coordinated.glb"
) {
  const rawBytes = readFileSync(sourcePath);
  const { gltf, binary } = readGlb(rawBytes);

  const evalGltf = structuredClone(gltf);
  for (const mesh of evalGltf.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) delete prim.material;
  }
  delete evalGltf.materials;
  delete evalGltf.images;
  delete evalGltf.textures;
  const stripped = encodeGlb(evalGltf, binary);

  const { scene, animations } = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(
      stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength),
      ""
    );

  const bones = {};
  scene.traverse((obj) => {
    if (obj.isBone) bones[obj.name] = obj;
  });

  const bindWorld = {};
  scene.updateMatrixWorld(true);
  for (const [name, bone] of Object.entries(bones)) {
    bindWorld[name] = bone.matrixWorld.clone();
  }

  const nodeByName = new Map(gltf.nodes.map((n, i) => [n.name, i]));
  const chunks = [binary];
  let binLength = binary.length;

  function appendRawBufferView(bufChunk, byteStride) {
    const pad = (4 - (binLength % 4)) % 4;
    if (pad > 0) {
      chunks.push(Buffer.alloc(pad));
      binLength += pad;
    }
    const bvIdx = gltf.bufferViews.length;
    const bv = {
      buffer: 0,
      byteOffset: binLength,
      byteLength: bufChunk.length,
    };
    if (byteStride !== undefined) bv.byteStride = byteStride;
    gltf.bufferViews.push(bv);
    chunks.push(bufChunk);
    binLength += bufChunk.length;
    return bvIdx;
  }

  function appendFloatAccessor(values, type, count) {
    const components = type === "SCALAR" ? 1 : type === "VEC3" ? 3 : type === "VEC4" ? 4 : 0;
    assert.equal(values.length, count * components);
    const bufChunk = Buffer.alloc(values.length * 4);
    const mins = Array(components).fill(Infinity);
    const maxs = Array(components).fill(-Infinity);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < components; c++) {
        const v = values[i * components + c];
        bufChunk.writeFloatLE(v, (i * components + c) * 4);
        if (v < mins[c]) mins[c] = v;
        if (v > maxs[c]) maxs[c] = v;
      }
    }
    const bvIdx = appendRawBufferView(bufChunk);
    const accIdx = gltf.accessors.length;
    gltf.accessors.push({
      bufferView: bvIdx,
      componentType: 5126,
      count,
      type,
      min: mins,
      max: maxs,
    });
    return accIdx;
  }

  function isConstantSeries(samples, components, eps = 1e-5) {
    const first = samples.slice(0, components);
    for (let i = components; i < samples.length; i += components) {
      for (let c = 0; c < components; c++) {
        if (Math.abs(samples[i + c] - first[c]) > eps) return false;
      }
    }
    return true;
  }

  function setChannelTrack(anim, boneName, path, fullTimeAccIdx, twoPointTimeAccIdx, flatValues, count) {
    const nodeIdx = nodeByName.get(boneName);
    assert.notEqual(nodeIdx, undefined, `Missing node ${boneName}`);
    const type = path === "rotation" ? "VEC4" : "VEC3";
    const components = path === "rotation" ? 4 : 3;

    let timeAcc = fullTimeAccIdx;
    let outValues = flatValues;
    let outCount = count;
    if (count > 2 && isConstantSeries(flatValues, components)) {
      timeAcc = twoPointTimeAccIdx;
      outValues = [
        ...flatValues.slice(0, components),
        ...flatValues.slice((count - 1) * components, count * components),
      ];
      outCount = 2;
    }

    const outAccIdx = appendFloatAccessor(outValues, type, outCount);
    anim.channels = anim.channels.filter(
      (c) => !(c.target.node === nodeIdx && c.target.path === path)
    );
    const samplerIdx = anim.samplers.length;
    anim.samplers.push({
      input: timeAcc,
      output: outAccIdx,
      interpolation: "LINEAR",
    });
    anim.channels.push({
      sampler: samplerIdx,
      target: { node: nodeIdx, path },
    });
  }

  function solvePanelsForCurrentPose(f, nFrames, breathDeg = 0.35) {
    for (const name of PANEL_NAMES) {
      const side = name[0];
      const [panel, seg] = name.split("Panel")[1].split("_").map(Number);
      const adj = [`${side}_WingD${panel}P${seg + 1}`, `${side}_WingD${panel + 1}P${seg + 1}`];
      const deltas = adj.map((a) =>
        new Matrix4().multiplyMatrices(bones[a].matrixWorld, bindWorld[a].clone().invert())
      );
      const q0 = new Quaternion().setFromRotationMatrix(deltas[0]);
      const q1 = new Quaternion().setFromRotationMatrix(deltas[1]);
      if (q0.dot(q1) < 0) q1.set(-q1.x, -q1.y, -q1.z, -q1.w);
      const qAvg = q0.clone().slerp(q1, 0.5);
      const bindHead = new Vector3().setFromMatrixPosition(bindWorld[name]);
      const t0 = bindHead.clone().applyMatrix4(deltas[0]);
      const t1 = bindHead.clone().applyMatrix4(deltas[1]);
      const tAvg = t0.add(t1).multiplyScalar(0.5);
      const skinAvg = new Matrix4().makeRotationFromQuaternion(qAvg);
      const targetWorld = new Matrix4().multiplyMatrices(skinAvg, bindWorld[name]);
      targetWorld.setPosition(tAvg);
      const parentWorldInv = bones[name].parent.matrixWorld.clone().invert();
      const localMat = new Matrix4().multiplyMatrices(parentWorldInv, targetWorld);
      localMat.decompose(bones[name].position, bones[name].quaternion, bones[name].scale);

      const phase = panel * 0.26 + seg * 0.13;
      const angle = ((breathDeg * Math.PI) / 180) * Math.sin((2.0 * Math.PI * f) / nFrames + phase);
      const qBreath = new Quaternion().setFromEuler(new Euler(angle, 0, 0, "XYZ"));
      if (side === "R") qBreath.set(qBreath.x, -qBreath.y, -qBreath.z, qBreath.w);
      bones[name].quaternion.multiply(qBreath);
      bones[name].updateMatrix();
      bones[name].updateMatrixWorld(true);
    }
  }

  const restClip = animations.find((a) => a.name === "rest");
  const idleClip = animations.find((a) => a.name === "idle");
  const walkClip = animations.find((a) => a.name === "walk");
  const idleGltfAnim = gltf.animations.find((a) => a.name === "idle");
  const walkGltfAnim = gltf.animations.find((a) => a.name === "walk");

  const mixer = new AnimationMixer(scene);
  const restAction = mixer.clipAction(restClip).setLoop(LoopOnce, 1);
  restAction.play();
  mixer.setTime(0);
  scene.updateMatrixWorld(true);
  const restWingRootWorld = {
    L: bones["L_WingRoot"].getWorldQuaternion(new Quaternion()),
    R: bones["R_WingRoot"].getWorldQuaternion(new Quaternion()),
  };
  mixer.stopAllAction();

  // 1. Upgrade `idle` (144 frames): level the head to the horizon (`Neck1 -4.0°`, `Neck2 -5.0°`,
  //    `Head -3.5°` — see the warning at the lift constants below) and align WingRoot with the
  //    ground-supported shoulder carriage.
  const idleFrames = 144;
  const idleCount = idleFrames + 1;
  const idleTimes = Array.from({ length: idleCount }, (_, f) => (idleClip.duration * f) / idleFrames);
  const idleTargetBones = [...NECK_HEAD_NAMES, "L_WingRoot", "R_WingRoot"];
  const idleRotSamples = Object.fromEntries(idleTargetBones.map((n) => [n, []]));
  const idlePanelPos = Object.fromEntries(PANEL_NAMES.map((n) => [n, []]));
  const idlePanelRot = Object.fromEntries(PANEL_NAMES.map((n) => [n, []]));

  const idleAct = mixer.clipAction(idleClip).setLoop(LoopOnce, 1);
  idleAct.clampWhenFinished = true;
  idleAct.play();

  // Horizon-leveling counter-pitch: idle's Body sits +12.9° forward, so a
  // neutral neck reads +13.0° nose-down. -12.5° total lift holds a ~+0.4°
  // world eyeline (matching walk's +0.8°). Do NOT raise this — the previous
  // -12°/-12°/-8° (-32°) lift produced the craned -65° idle defect.
  const neckLiftQuats = {
    Neck1: new Quaternion().setFromEuler(new Euler((-4.0 * Math.PI) / 180, 0, 0, "XYZ")),
    Neck2: new Quaternion().setFromEuler(new Euler((-5.0 * Math.PI) / 180, 0, 0, "XYZ")),
    Head: new Quaternion().setFromEuler(new Euler((-3.5 * Math.PI) / 180, 0, 0, "XYZ")),
  };

  for (let f = 0; f <= idleFrames; f++) {
    mixer.setTime(idleTimes[f]);
    scene.updateMatrixWorld(true);

    for (const s of ["L", "R"]) {
      const b = bones[`${s}_WingRoot`];
      const pwInv = b.parent.getWorldQuaternion(new Quaternion()).invert();
      const targetLocal = pwInv.multiply(restWingRootWorld[s].clone());
      if (b.quaternion.dot(targetLocal) < 0) {
        targetLocal.set(-targetLocal.x, -targetLocal.y, -targetLocal.z, -targetLocal.w);
      }
      b.quaternion.slerp(targetLocal, 0.55);
      b.updateMatrix();
    }

    for (const [bname, qLift] of Object.entries(neckLiftQuats)) {
      bones[bname].quaternion.premultiply(qLift);
      bones[bname].updateMatrix();
    }

    scene.updateMatrixWorld(true);
    solvePanelsForCurrentPose(f, idleFrames, 0.35);

    for (const bname of idleTargetBones) {
      const q = bones[bname].quaternion.clone();
      const prev = idleRotSamples[bname].at(-1);
      if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      idleRotSamples[bname].push(q);
    }
    for (const name of PANEL_NAMES) {
      const q = bones[name].quaternion.clone();
      const prev = idlePanelRot[name].at(-1);
      if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      idlePanelRot[name].push(q);
      idlePanelPos[name].push(bones[name].position.clone());
    }
  }
  mixer.stopAllAction();

  for (const bname of idleTargetBones) {
    const qEnd = idleRotSamples[bname][0].clone();
    if (qEnd.dot(idleRotSamples[bname][idleFrames - 1]) < 0) qEnd.set(-qEnd.x, -qEnd.y, -qEnd.z, -qEnd.w);
    idleRotSamples[bname][idleFrames] = qEnd;
  }
  for (const name of PANEL_NAMES) {
    idlePanelPos[name][idleFrames] = idlePanelPos[name][0].clone();
    const qEnd = idlePanelRot[name][0].clone();
    if (qEnd.dot(idlePanelRot[name][idleFrames - 1]) < 0) qEnd.set(-qEnd.x, -qEnd.y, -qEnd.z, -qEnd.w);
    idlePanelRot[name][idleFrames] = qEnd;
  }

  const idleFullTimeAcc = appendFloatAccessor(idleTimes, "SCALAR", idleCount);
  const idleTwoPtTimeAcc = appendFloatAccessor([0, idleClip.duration], "SCALAR", 2);
  for (const bname of idleTargetBones) {
    const flat = idleRotSamples[bname].flatMap((q) => [q.x, q.y, q.z, q.w]);
    setChannelTrack(idleGltfAnim, bname, "rotation", idleFullTimeAcc, idleTwoPtTimeAcc, flat, idleCount);
  }
  for (const name of PANEL_NAMES) {
    setChannelTrack(
      idleGltfAnim, name, "translation", idleFullTimeAcc, idleTwoPtTimeAcc,
      idlePanelPos[name].flatMap((p) => [p.x, p.y, p.z]), idleCount
    );
    setChannelTrack(
      idleGltfAnim, name, "rotation", idleFullTimeAcc, idleTwoPtTimeAcc,
      idlePanelRot[name].flatMap((q) => [q.x, q.y, q.z, q.w]), idleCount
    );
  }

  const idleWingRef = {};
  const idleWingRootInBody = {};
  const idleActRef = mixer.clipAction(idleClip).setLoop(LoopOnce, 1);
  idleActRef.play();
  mixer.setTime(0);
  scene.updateMatrixWorld(true);
  for (const s of ["L", "R"]) {
    const b = bones[`${s}_WingRoot`];
    const pwInv = b.parent.getWorldQuaternion(new Quaternion()).invert();
    const targetLocal = pwInv.multiply(restWingRootWorld[s].clone());
    if (b.quaternion.dot(targetLocal) < 0) targetLocal.set(-targetLocal.x, -targetLocal.y, -targetLocal.z, -targetLocal.w);
    b.quaternion.slerp(targetLocal, 0.55);
    b.updateMatrix();
  }
  scene.updateMatrixWorld(true);
  const bodyWorldQ0Inv = bones["Body"].getWorldQuaternion(new Quaternion()).invert();
  for (const s of ["L", "R"]) {
    const wrQ = bones[`${s}_WingRoot`].getWorldQuaternion(new Quaternion());
    idleWingRootInBody[s] = bodyWorldQ0Inv.clone().multiply(wrQ);
  }
  for (const bname of WING_CHAIN_NAMES) {
    idleWingRef[bname] = bones[bname].quaternion.clone();
  }
  mixer.stopAllAction();

  // 2. Upgrade `walk` (59 frames): balance wingtip gait asymmetry in Body space and lock stance foot/toe contacts to ground plane
  const walkFrames = 59;
  const walkCount = walkFrames + 1;
  const walkTimes = Array.from({ length: walkCount }, (_, f) => (walkClip.duration * f) / walkFrames);
  const walkTargetBones = [...WING_CHAIN_NAMES, "L_Calf", "R_Calf", "L_Foot", "R_Foot", "L_Toes", "R_Toes"];
  const walkRotSamples = Object.fromEntries(walkTargetBones.map((n) => [n, []]));
  const walkPanelPos = Object.fromEntries(PANEL_NAMES.map((n) => [n, []]));
  const walkPanelRot = Object.fromEntries(PANEL_NAMES.map((n) => [n, []]));

  const walkAct = mixer.clipAction(walkClip).setLoop(LoopOnce, 1);
  walkAct.clampWhenFinished = true;
  walkAct.play();

  for (let f = 0; f <= walkFrames; f++) {
    mixer.setTime(walkTimes[f]);
    scene.updateMatrixWorld(true);

    // Stabilize WingRoot in Body frame so Spine1..3 yaw/roll does not whip the wingtips >0.8m apart
    const bodyQ = bones["Body"].getWorldQuaternion(new Quaternion());
    for (const s of ["L", "R"]) {
      const wr = bones[`${s}_WingRoot`];
      const parentWorldInv = wr.parent.getWorldQuaternion(new Quaternion()).invert();
      const desiredWorldQ = bodyQ.clone().multiply(idleWingRootInBody[s]);
      const bodyLockedLocal = parentWorldInv.multiply(desiredWorldQ);
      const qWalk = wr.quaternion.clone();
      if (bodyLockedLocal.dot(qWalk) < 0) qWalk.set(-qWalk.x, -qWalk.y, -qWalk.z, -qWalk.w);
      wr.quaternion.copy(bodyLockedLocal.slerp(qWalk, 0.25));
      wr.updateMatrix();
    }

    for (const bname of WING_CHAIN_NAMES) {
      if (bname.endsWith("WingRoot")) continue;
      const qRef = idleWingRef[bname].clone();
      const qWalk = bones[bname].quaternion.clone();
      if (qRef.dot(qWalk) < 0) qWalk.set(-qWalk.x, -qWalk.y, -qWalk.z, -qWalk.w);
      const alpha = bname.includes("WingShoulder")
        ? 0.25
        : bname.includes("WingElbow") || bname.includes("WingWrist")
          ? 0.20
          : 0.14;
      bones[bname].quaternion.copy(qRef.slerp(qWalk, alpha));
      bones[bname].updateMatrix();
    }

    scene.updateMatrixWorld(true);
    for (const side of ["L", "R"]) {
      const foot = bones[`${side}_Foot`];
      const toes = bones[`${side}_Toes`];
      const calf = bones[`${side}_Calf`];
      const toeWorld = toes.getWorldPosition(new Vector3());
      const stanceFloorToeY = -12.0;
      if (toeWorld.y < stanceFloorToeY) {
        const deficit = stanceFloorToeY - toeWorld.y;
        const liftRad = Math.min(0.22, deficit * 0.0042);
        const qCalfLift = new Quaternion().setFromEuler(new Euler(-liftRad * 0.65, 0, 0, "XYZ"));
        const qFootLevel = new Quaternion().setFromEuler(new Euler(liftRad * 0.85, 0, 0, "XYZ"));
        calf.quaternion.multiply(qCalfLift);
        calf.updateMatrix();
        foot.quaternion.multiply(qFootLevel);
        foot.updateMatrix();
      }
    }

    scene.updateMatrixWorld(true);
    solvePanelsForCurrentPose(f, walkFrames, 0.35);

    for (const bname of walkTargetBones) {
      const q = bones[bname].quaternion.clone();
      const prev = walkRotSamples[bname].at(-1);
      if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      walkRotSamples[bname].push(q);
    }
    for (const name of PANEL_NAMES) {
      const q = bones[name].quaternion.clone();
      const prev = walkPanelRot[name].at(-1);
      if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      walkPanelRot[name].push(q);
      walkPanelPos[name].push(bones[name].position.clone());
    }
  }
  mixer.stopAllAction();

  for (const bname of walkTargetBones) {
    const qEnd = walkRotSamples[bname][0].clone();
    if (qEnd.dot(walkRotSamples[bname][walkFrames - 1]) < 0) qEnd.set(-qEnd.x, -qEnd.y, -qEnd.z, -qEnd.w);
    walkRotSamples[bname][walkFrames] = qEnd;
  }
  for (const name of PANEL_NAMES) {
    walkPanelPos[name][walkFrames] = walkPanelPos[name][0].clone();
    const qEnd = walkPanelRot[name][0].clone();
    if (qEnd.dot(walkPanelRot[name][walkFrames - 1]) < 0) qEnd.set(-qEnd.x, -qEnd.y, -qEnd.z, -qEnd.w);
    walkPanelRot[name][walkFrames] = qEnd;
  }

  const walkFullTimeAcc = appendFloatAccessor(walkTimes, "SCALAR", walkCount);
  const walkTwoPtTimeAcc = appendFloatAccessor([0, walkClip.duration], "SCALAR", 2);
  for (const bname of walkTargetBones) {
    const flat = walkRotSamples[bname].flatMap((q) => [q.x, q.y, q.z, q.w]);
    setChannelTrack(walkGltfAnim, bname, "rotation", walkFullTimeAcc, walkTwoPtTimeAcc, flat, walkCount);
  }
  for (const name of PANEL_NAMES) {
    setChannelTrack(
      walkGltfAnim, name, "translation", walkFullTimeAcc, walkTwoPtTimeAcc,
      walkPanelPos[name].flatMap((p) => [p.x, p.y, p.z]), walkCount
    );
    setChannelTrack(
      walkGltfAnim, name, "rotation", walkFullTimeAcc, walkTwoPtTimeAcc,
      walkPanelRot[name].flatMap((q) => [q.x, q.y, q.z, q.w]), walkCount
    );
  }

  // 3. Weld the 356 duplicate seam vertex normals & smooth acute inner-elbow/axilla skin weights
  const membraneStats = weldMembraneNormalsAndSmoothAxillaWeights(gltf, binary, appendRawBufferView);

  const endPad = (4 - (binLength % 4)) % 4;
  if (endPad > 0) {
    chunks.push(Buffer.alloc(endPad));
    binLength += endPad;
  }
  gltf.buffers[0].byteLength = binLength;

  const uncompactedBytes = encodeGlb(gltf, Buffer.concat(chunks));
  const contractPath = "scripts/blender/wyvern_v2_runtime_contract.json";
  const contract = JSON.parse(readFileSync(contractPath, "utf8"));
  contract.signature = inspectRuntimeRig(uncompactedBytes);
  writeFileSync(contractPath, JSON.stringify(contract, null, 2) + "\n");

  const tempPath = `${basePath}.upgrade.tmp`;
  writeFileSync(tempPath, uncompactedBytes);
  let compactStats;
  try {
    compactStats = compactGlb(tempPath, tempPath);
    const finalBytes = readFileSync(tempPath);
    const sha256 = createHash("sha256").update(finalBytes).digest("hex");

    contract.asset.sha256 = sha256;
    contract.asset.bytes = finalBytes.length;
    contract.signature = inspectRuntimeRig(finalBytes);
    writeFileSync(contractPath, JSON.stringify(contract, null, 2) + "\n");

    writeValidatedRuntimeRig(basePath, finalBytes);
    for (const candPath of [
      "public/models/wyvern-v2-membrane-lab-candidate.glb",
      "public/models/wyvern-v2-idle-walk-flight-lab-candidate.glb",
    ]) {
      copyFileSync(basePath, candPath);
    }

    const budgetPath = "tools/asset-budget.json";
    if (existsSync(budgetPath)) {
      const budget = JSON.parse(readFileSync(budgetPath, "utf8"));
      for (const key of [
        "/models/wyvern-v2-rig.glb",
        "/models/wyvern-v2-membrane-lab-candidate.glb",
        "/models/wyvern-v2-idle-walk-flight-lab-candidate.glb",
      ]) {
        if (budget.exceptions?.[key]) {
          budget.exceptions[key].bytes = finalBytes.length;
        }
      }
      writeFileSync(budgetPath, JSON.stringify(budget, null, 2) + "\n");
    }

    const validation = validateRuntimeRig(finalBytes);
    return {
      passed: validation.passed,
      sha256,
      bytes: finalBytes.length,
      membraneStats,
      compactStats,
    };
  } finally {
    rmSync(tempPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^[./]+/, ""))) {
  const report = await upgradeV2RigGroundAndMembrane();
  console.log(JSON.stringify(report, null, 2));
}
