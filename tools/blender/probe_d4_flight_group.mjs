#!/usr/bin/env node
// Probe: what would it take to close cruise + both banks on the dynamics gate,
// and what does each candidate do to the two invariants that blocked them?
//
// Reports, per variant:
//   dynamics   peak / p95 / mean / accelMax  (the gate channels)
//   span       maxMembraneX at t = 1.0 s (the frame the kinetics test samples),
//              the max over the whole cycle, and the minimum wingtip X — the last
//              one is what says a gain folded the wing through the body.
//
// Read-only: writes nothing but stdout.
import { readFileSync } from "node:fs";
import { AnimationMixer, Matrix4, Vector3 } from "three";
import { readGlb, encodeGlb } from "./runtime_rig_contract.mjs";
import {
  makeAppendor, decodeFloats, rotationChannels, clipDuration, GROUPS, ripple, qmul, qinv, qpow, qnorm,
  PROTECTED, PANEL_COUPLED, smoothOnce,
} from "./glb_clip_edit.mjs";
import { loadRig, measureClipDynamics } from "../../scripts/wyvern-dynamics.mjs";

const INPUT = process.argv[2] ?? "public/models/wyvern-v2-rig.glb";
const baseBytes = readFileSync(INPUT);

const { gltf, binary } = readGlb(baseBytes);
const bindRot = new Map(gltf.nodes.filter((n) => n.name).map((n) => [n.name, n.rotation ?? [0, 0, 0, 1]]));

function buildVariant(clipName, { gain = 1, floor = 0, floorGroups = null, smoothing = 0, onlyRe = null }) {
  const anim = gltf.animations.find((a) => a.name === clipName);
  const duration = clipDuration(gltf, binary, anim);
  const cycles = Math.max(1, Math.round(duration * 0.6));
  const only = onlyRe ? new RegExp(onlyRe) : null;
  const writes = [];
  for (const rc of rotationChannels(gltf, binary, anim)) {
    if (rc.times.length < 4) continue;
    if (PROTECTED.has(rc.name)) continue;
    if (PANEL_COUPLED.test(rc.name)) continue;
    if (only && !only.test(rc.name)) continue;

    const bind = bindRot.get(rc.name) ?? [0, 0, 0, 1];
    let source = rc.values;
    for (let p = 0; p < smoothing; p++) source = smoothOnce(source, rc.times.length);

    const out = [];
    for (let k = 0; k < rc.times.length; k++) {
      const q = source.slice(k * 4, k * 4 + 4);
      out.push(...qnorm(qmul(bind, qpow(qmul(qinv(bind), q), gain))));
    }
    let result = out;
    if (floor > 0) {
      for (const group of floorGroups ?? Object.keys(GROUPS)) {
        const r = ripple({ ...rc, values: result }, { group, amplitudeDeg: floor, cycles, duration });
        if (r) result = r;
      }
    }
    writes.push({ name: rc.name, out: result });
  }
  return { writes, duration };
}

function encodeVariant(clipName, params) {
  const { writes } = buildVariant(clipName, params);
  const trial = structuredClone(gltf);
  const app = makeAppendor(trial, binary);
  const anim = trial.animations.find((a) => a.name === clipName);
  const byName = new Map(rotationChannels(trial, binary, anim).map((c) => [c.name, c]));
  for (const { name, out } of writes) byName.get(name).sampler.output = app.appendFloats(out, "VEC4");
  if (params?.retime && params.retime !== 1) {
    // Scale every key time of every channel; pose sequence untouched.
    const source = gltf.animations.find((a) => a.name === clipName);
    const trialAnim = trial.animations.find((a) => a.name === clipName);
    for (let i = 0; i < source.channels.length; i++) {
      const times = decodeFloats(gltf, binary, source.samplers[source.channels[i].sampler].input);
      trialAnim.samplers[trialAnim.channels[i].sampler].input =
        app.appendFloats(times.map((t) => t * params.retime), "SCALAR");
    }
  }
  return encodeGlb(trial, app.finish());
}

/** Max skinned membrane X at `time` (same CPU-skinning path the kinetics test uses). */
function membraneSpan(rig, clip, time) {
  let membrane = null, tip = null;
  rig.scene.traverse((o) => {
    if (o.isSkinnedMesh && o.name.includes("Membrane")) membrane = o;
    if (o.isBone && o.name === "L_WingD0P2") tip = o;
  });
  const mixer = new AnimationMixer(rig.scene);
  const action = mixer.clipAction(clip);
  action.play();
  mixer.setTime(time);
  rig.scene.updateMatrixWorld(true);
  membrane.skeleton.update();

  const geom = membrane.geometry;
  const pos = geom.attributes.position;
  const si = geom.attributes.skinIndex;
  const sw = geom.attributes.skinWeight;
  const bm = membrane.skeleton.boneMatrices;
  let maxX = -Infinity;
  const v = new Vector3(), acc = new Vector3(), tmp = new Vector3(), bMat = new Matrix4();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    acc.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > 0) {
        bMat.fromArray(bm, si.getComponent(i, k) * 16);
        acc.add(tmp.copy(v).applyMatrix4(bMat).multiplyScalar(w));
      }
    }
    acc.applyMatrix4(membrane.matrixWorld);
    if (acc.x > maxX) maxX = acc.x;
  }
  const tipPos = new Vector3();
  tip.getWorldPosition(tipPos);
  mixer.stopAllAction();
  mixer.uncacheRoot(rig.scene);
  return { maxX, tipX: tipPos.x };
}

// Cadence is deliberately NOT measured here. The "half-cycles above 50% of peak"
// estimator used in doc 36 §6 is what produced the wrong answer the first time:
// it counts a secondary bump as a beat, and a gain raises the peak so the bump
// crosses the threshold and the count changes on a clip whose timing never moved.
// `scripts/validate-wyvern-clips.mjs` owns the real estimator (dominant DFT bin
// of the wingtip elevation in the Body frame) and is the authority on the 8%
// flight-group lock.

async function evaluate(label, clipName, params, { sampleTimes = null } = {}) {
  const bytes = params ? encodeVariant(clipName, params) : baseBytes;
  const path = `/tmp/probe-d4-${process.pid}.glb`;
  const { writeFileSync, rmSync } = await import("node:fs");
  writeFileSync(path, bytes);
  let rig;
  try {
    rig = await loadRig(path);
  } finally {
    rmSync(path, { force: true });
  }
  const clip = rig.gltf.animations.find((a) => a.name === clipName);
  const m = measureClipDynamics(clip, rig.scene, rig.deforming);
  const at1 = membraneSpan(rig, clip, 1.0);
  const times = sampleTimes ?? Array.from({ length: 13 }, (_, i) => (i * clip.duration) / 12);
  let cyclePeak = -Infinity;
  let tipMin = Infinity;
  for (const t of times) {
    const s = membraneSpan(rig, clip, t);
    cyclePeak = Math.max(cyclePeak, s.maxX);
    tipMin = Math.min(tipMin, s.tipX);
  }
  const row = {
    label,
    peak: +m.peak.toFixed(1), p95: +m.p95.toFixed(1), mean: +m.mean.toFixed(1),
    accel: +Math.round(m.accelMax), sustained: m.sustained, peakJoint: m.peakJoint,
    span1s: +at1.maxX.toFixed(1), tipX: +at1.tipX.toFixed(1),
    spanCyclePeak: +cyclePeak.toFixed(1), tipMin: +tipMin.toFixed(1),
  };
  console.log(JSON.stringify(row));
  return row;
}

const clipName = process.argv[3] ?? "cruise";
const grid = JSON.parse(process.argv[4] ?? '[{"label":"authored","params":null}]');

for (const { label, params } of grid) {
  await evaluate(label, clipName, params);
}
