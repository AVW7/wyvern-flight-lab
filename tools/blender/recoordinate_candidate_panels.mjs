#!/usr/bin/env node
// Re-coordinate the 16 wing membrane panel bones on any GLB whose digit tracks
// were modified (e.g. after dynamics amplification or buzz-clip reshaping).
// Ensures all clips satisfy the <= 1.0 deg panel coordination contract.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AnimationMixer, Euler, LoopOnce, Matrix4, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { readGlb, encodeGlb, validateRuntimeRig, writeValidatedRuntimeRig } from "./runtime_rig_contract.mjs";
import { compactGlb } from "./compact_v2_glb.mjs";
import { PANEL_NAMES } from "./package_panel_coordination.mjs";

await MeshoptDecoder.ready;

const INPUT = process.argv[2] ?? "assets/rig-audits/2026-10-21-dynamics/candidates/wyvern-v2-dynamics-candidate.glb";
const OUTPUT = process.argv[3] ?? INPUT;
const CLIPS_FILTER = process.argv.slice(4); // optional specific clip names

const LOOPING_CLIPS = new Set([
  "bankLeft", "bankRight", "cruise", "dive", "glide", "hover",
  "idle", "rest", "scout", "speed", "walk",
]);

function mathSinCycle(f, nFrames, phase) {
  return Math.sin((2.0 * Math.PI * f) / nFrames + phase);
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

export async function recoordinatePanels(inputPath, outputPath, clipNames = null) {
  const buf = readFileSync(inputPath);
  const { gltf, binary } = readGlb(buf);

  // Prepare clean Three.js evaluation scene
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
    .parseAsync(stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength), "");

  const bones = {};
  scene.traverse((obj) => {
    if (obj.isBone) bones[obj.name] = obj;
  });

  const bindWorld = {};
  const bindQuat = {};
  scene.updateMatrixWorld(true);
  for (const [name, bone] of Object.entries(bones)) {
    bindWorld[name] = bone.matrixWorld.clone();
    bindQuat[name] = bone.quaternion.clone();
  }

  const nodeByName = new Map(gltf.nodes.map((n, i) => [n.name, i]));
  const chunks = [binary];
  let binLength = binary.length;

  function appendFloatAccessor(values, type, count) {
    const components = type === "SCALAR" ? 1 : type === "VEC3" ? 3 : type === "VEC4" ? 4 : 0;
    assert.equal(values.length, count * components);
    const pad = (4 - (binLength % 4)) % 4;
    if (pad > 0) {
      chunks.push(Buffer.alloc(pad));
      binLength += pad;
    }
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
    const bvIdx = gltf.bufferViews.length;
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: binLength,
      byteLength: bufChunk.length,
    });
    chunks.push(bufChunk);
    binLength += bufChunk.length;

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

  const targetClips = clipNames && clipNames.length > 0
    ? clipNames
    : gltf.animations.map((a) => a.name);

  for (const clipName of targetClips) {
    const clip = animations.find((a) => a.name === clipName);
    const gltfAnim = gltf.animations.find((a) => a.name === clipName);
    if (!clip || !gltfAnim) continue;

    // Use at least 24 fps or 4x duration
    const nFrames = Math.min(144, Math.max(24, Math.round(clip.duration * 24)));
    const count = nFrames + 1;
    const times = Array.from({ length: count }, (_, f) => (clip.duration * f) / nFrames);
    const isLoop = LOOPING_CLIPS.has(clipName);

    const mixer = new AnimationMixer(scene);
    const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    const baselineFrames = [];
    for (let f = 0; f <= nFrames; f++) {
      mixer.setTime(times[f]);
      scene.updateMatrixWorld(true);
      const snap = {};
      for (const [bname, b] of Object.entries(bones)) {
        snap[bname] = {
          pos: b.position.clone(),
          quat: b.quaternion.clone(),
          scale: b.scale.clone(),
        };
      }
      baselineFrames.push(snap);
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(scene);

    const panelPosSamples = Object.fromEntries(PANEL_NAMES.map((n) => [n, []]));
    const panelRotSamples = Object.fromEntries(PANEL_NAMES.map((n) => [n, []]));

    for (let f = 0; f <= nFrames; f++) {
      const snap = baselineFrames[f];
      for (const [bname, b] of Object.entries(bones)) {
        b.position.copy(snap[bname].pos);
        b.quaternion.copy(snap[bname].quat);
        b.scale.copy(snap[bname].scale);
        b.updateMatrix();
      }
      scene.updateMatrixWorld(true);

      // Solve all 16 panel bones in parent->child order (segment 0 before segment 1)
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

        // Subtle aerodynamic/respiratory batten tension pulse (0.35° = 0.0061 rad)
        const phase = panel * 0.26 + seg * 0.13;
        const angle = ((0.35 * Math.PI) / 180) * mathSinCycle(f, nFrames, phase);
        const qBreath = new Quaternion().setFromEuler(new Euler(angle, 0, 0, "XYZ"));
        if (side === "R") qBreath.set(qBreath.x, -qBreath.y, -qBreath.z, qBreath.w);
        bones[name].quaternion.multiply(qBreath);

        bones[name].updateMatrix();
        bones[name].updateMatrixWorld(true);

        const qPanel = bones[name].quaternion.clone();
        const prev = panelRotSamples[name].at(-1);
        if (prev && prev.dot(qPanel) < 0) qPanel.set(-qPanel.x, -qPanel.y, -qPanel.z, -qPanel.w);
        panelRotSamples[name].push(qPanel);
        panelPosSamples[name].push(bones[name].position.clone());
      }
    }

    if (isLoop) {
      for (const name of PANEL_NAMES) {
        panelPosSamples[name][nFrames] = panelPosSamples[name][0].clone();
        const qEnd = panelRotSamples[name][0].clone();
        if (qEnd.dot(panelRotSamples[name][nFrames - 1]) < 0) {
          qEnd.set(-qEnd.x, -qEnd.y, -qEnd.z, -qEnd.w);
        }
        panelRotSamples[name][nFrames] = qEnd;
      }
    }

    const fullTimeAccIdx = appendFloatAccessor(times, "SCALAR", count);
    const twoPointTimeAccIdx = appendFloatAccessor([0, clip.duration], "SCALAR", 2);
    for (const name of PANEL_NAMES) {
      const flatPos = panelPosSamples[name].flatMap((p) => [p.x, p.y, p.z]);
      const flatRot = panelRotSamples[name].flatMap((q) => [q.x, q.y, q.z, q.w]);
      setChannelTrack(gltfAnim, name, "translation", fullTimeAccIdx, twoPointTimeAccIdx, flatPos, count);
      setChannelTrack(gltfAnim, name, "rotation", fullTimeAccIdx, twoPointTimeAccIdx, flatRot, count);
    }
    console.log(`[PanelCoord] Re-coordinated 16 panels on clip '${clipName}' (${nFrames} frames)`);
  }

  const endPad = (4 - (binLength % 4)) % 4;
  if (endPad > 0) {
    chunks.push(Buffer.alloc(endPad));
    binLength += endPad;
  }
  gltf.buffers[0].byteLength = binLength;
  const encoded = encodeGlb(gltf, Buffer.concat(chunks));

  const tmp = `${outputPath}.coord.tmp`;
  writeFileSync(tmp, encoded);
  try {
    compactGlb(tmp, tmp);
    const finalBytes = readFileSync(tmp);
    const isRuntime = resolve(outputPath) === resolve("public/models/wyvern-v2-rig.glb");
    writeValidatedRuntimeRig(outputPath, finalBytes);
    console.log(`[PanelCoord] Successfully wrote ${outputPath} (${finalBytes.length} bytes)`);
  } finally {
    try { rmSync(tmp, { force: true }); } catch {}
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  await recoordinatePanels(INPUT, OUTPUT, CLIPS_FILTER.length > 0 ? CLIPS_FILTER : null);
}
