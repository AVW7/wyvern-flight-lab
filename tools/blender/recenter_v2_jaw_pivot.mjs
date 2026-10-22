#!/usr/bin/env node
/**
 * Task C6, runtime half — move the shipped `Jaw` pivot to the mandible joint.
 *
 * The blend was fixed on 2026-10-22 (`fix_c6_jaw_pivot_and_stub_bones.py`), but the
 * shipped GLB was left alone, so Flight Lab still rendered the old pivot. This pass
 * applies the same change at GLB level, which is the only way to reach the runtime
 * without an export that would revert C5/D2–D4.
 *
 * ## What "move the pivot" means in glTF
 *
 * There is no rest pose to edit: a joint's world position is
 * `W_parent · T_channel · A_channel`, so the pivot is carried by the **translation
 * channels**, not only by `node.translation`. All 18 clips key Jaw translation,
 * rotation *and* scale, so all three have to be handled.
 *
 * The deformation of a vertex is `D = W_anim · IBM`. With `B = W_rest · IBM` (the
 * mesh→world map, joint-invariant — see `bindMeshToWorld`), the bind-relative
 * deformation is `E = D · B⁻¹`. At a closed jaw `E = I`; at an open jaw `E` is a
 * rotation about the hinge. A correct lateral hinge therefore has a **world-X**
 * rotation axis, which is the gate this pass is verified against.
 *
 * ## The change
 *
 *   T_channel  += δ_local        (δ_local = T_new − T_old, in the parent's frame)
 *   A_channel   = R_new · R_old⁻¹ · A_channel        (axis corrected, motion kept)
 *   node.TRS    = T_new, R_new
 *   IBM_jaw     = inverse(W_target) · B
 *
 * `R_new` is the same construction the blend used: local `X` exactly world-lateral,
 * local `Y` the current bone direction projected into the sagittal plane, `Z = X×Y`.
 * Conjugating the rotation channels by `R_new·R_old⁻¹` keeps every frame's
 * *bind-relative* rotation while re-expressing it in the corrected frame — the same
 * identity the blend's `rest_reframe.py` applies to Blender fcurves.
 *
 * ## Coordinates
 *
 * Blend armature space → glTF world is the plain Y-up conversion `(x, y, z) → (x, z, −y)`.
 * Measured over the 91 joints that C6 did not move: scale `1.00000009`, translation
 * `(−0.0002, 0.0003, 0.0003)`, worst residual **0.0014** units. The mandible joint
 * `[0, −565, 785]` therefore lands at `[0, 785, 565]` in glTF world.
 *
 * Usage:
 *   node tools/blender/recenter_v2_jaw_pivot.mjs [--out <candidate.glb>] [--write] [--report]
 *
 * Dry run by default. `--out` writes an unpinned candidate. `--write` re-signs and
 * re-pins the runtime contract via `writeValidatedRuntimeRig`.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Matrix4, Quaternion, Vector3 } from "three";

import {
  CONTRACT_PATH,
  RUNTIME_PATH,
  encodeGlb,
  inspectRuntimeRig,
  readGlb,
  validateRuntimeRig,
} from "./runtime_rig_contract.mjs";
import { createRig, decodeAccessor, readSkin } from "./glb_skin_io.mjs";
import { decodeFloats, makeAppendor, qinv, qmul, qnorm, writeFloatsInPlace } from "./glb_clip_edit.mjs";

/** Anatomical mandible hinge, in blend armature space. */
const MANDIBLE_BLEND = [0, -565, 785];
/** Blend armature space → glTF world (Y-up). */
const toGltf = ([x, y, z]) => [x, z, -y];
const AXIS_TOLERANCE_DEG = 0.05;
/**
 * Below this much deformation there is no hinge to measure — a quaternion's axis is
 * `v/|v|` with `v = sin(θ/2)·axis`, so it degenerates to rounding noise as `θ → 0`.
 */
const MIN_AXIS_DEG = 0.1;
/** `W_new · IBM_new` vs `W_old · IBM_old`; the rig scale is ~2188, so this is ~5e-6 relative. */
const BIND_TOLERANCE = 0.01;
/** Sideways drift of the jaw mesh at 45° open. The jaw is 366 units wide, so this is ~3e-5. */
const LATERAL_TOLERANCE = 0.01;
/** Promoted aliases that `test/asset-provenance.test.js` pins to the shipped bytes. */
const CANDIDATE_ALIASES = [
  fileURLToPath(new URL("../../public/models/wyvern-v2-idle-walk-flight-lab-candidate.glb", import.meta.url)),
  fileURLToPath(new URL("../../public/models/wyvern-v2-membrane-lab-candidate.glb", import.meta.url)),
];

function worldOf(rig, name) {
  return rig.worldMatrix(rig.nodeIndexByName.get(name)).clone();
}

function quatAxisAngleDeg(q) {
  const w = Math.min(1, Math.abs(q.w));
  const angle = 2 * Math.acos(w) * (180 / Math.PI);
  const s = Math.sqrt(Math.max(0, 1 - w * w));
  const axis = s < 1e-9 ? new Vector3(1, 0, 0) : new Vector3(q.x / s, q.y / s, q.z / s).normalize();
  return { angle, axis };
}

function axisVsWorldXDeg(axis) {
  return (Math.acos(Math.min(1, Math.abs(axis.x))) * 180) / Math.PI;
}

/**
 * `E = W_rest(parent) · local · W_rest(Jaw)⁻¹` — the bind-relative deformation.
 *
 * Written without the bind matrix on purpose: `E = W_anim·IBM·(W_rest·IBM)⁻¹` and the
 * IBM cancels algebraically. Keeping it out of the signature means this number can never
 * silently depend on an IBM edit that it does not actually test.
 *
 * The parent is held at **rest**. That is deliberate: the hinge is a property of the
 * jaw's own frame, and the head's animated rotation carries the hinge with it — correct
 * anatomy, not a defect. Measuring against the animated parent would fold the head's
 * motion into the number and let a tilted hinge hide behind a head roll.
 */
function deformation(rig, nodeIndex, local) {
  const parent = rig.parentOf.get(nodeIndex);
  assert.ok(parent !== undefined, "Jaw has no parent node");
  const world = rig.worldMatrix(parent).clone().multiply(local);
  return world.multiply(rig.worldMatrix(nodeIndex).clone().invert());
}

/** `B = W_rest(Jaw) · IBM(Jaw)` — the jaw's slice of the mesh-local → world bind map. */
function jawBindMap(gltf, binary, rig = createRig(gltf)) {
  const skin = gltf.skins[0];
  const jawJoint = skin.joints.indexOf(rig.nodeIndexByName.get("Jaw"));
  assert.ok(jawJoint >= 0, "Jaw is not a skin joint");
  const ibm = decodeAccessor(gltf, binary, skin.inverseBindMatrices);
  const m = new Matrix4();
  for (let c = 0; c < 16; c++) m.elements[c] = ibm.get(jawJoint, c);
  return worldOf(rig, "Jaw").multiply(m);
}

/** Rotation axis of a bind-relative deformation matrix, and its angle. */
function deformationAxis(e) {
  const q = new Quaternion();
  e.decompose(new Vector3(), q, new Vector3());
  return quatAxisAngleDeg(q);
}

/**
 * Vertex-level statement of the same claim: open the jaw by `openDeg` and measure how far
 * the jaw's vertices drift **sideways**.
 *
 * The axis check above is algebraic; this is the thing that renders. A lateral hinge
 * rotates in the sagittal plane, so world X must not move at all — that is exactly the
 * "jaw yaws sideways" symptom C6 set out to remove.
 *
 * Every vertex the Jaw influences is used, blended properly: with no other joint animated
 * `E_other = I`, so a vertex is `w·E_jaw·p + (1−w)·p`. Blending therefore scales the
 * drift, it does not hide it, and the exact answer is still zero. (Requiring a full
 * 255 weight instead found **no vertices at all** — the jaw is blended everywhere.)
 */
function jawVertexLateralDrift(gltf, binary, openDeg = 45) {
  const rig = createRig(gltf);
  const jawIdx = rig.nodeIndexByName.get("Jaw");
  const parent = rig.parentOf.get(jawIdx);
  const localRest = rig.worldMatrix(parent).clone().invert().multiply(worldOf(rig, "Jaw"));
  const local = localRest.clone().multiply(new Matrix4().makeRotationX((openDeg * Math.PI) / 180));
  const e = deformation(rig, jawIdx, local);

  const jawJoint = rig.jointIndexByName.get("Jaw");
  const skin = readSkin(gltf, binary, "WyvernBody_Rebuild");
  let vertices = 0;
  let maxLateralDrift = 0;
  let maxDisplacement = 0;
  for (const vertex of skin.vertices) {
    const slot = [0, 1, 2, 3].find((s) => vertex.joints[s] === jawJoint && vertex.weights[s] > 0);
    if (slot === undefined) continue;
    vertices++;
    const weight = vertex.weights[slot] / 255;
    const p = new Vector3(...vertex.position);
    const moved = p.clone().multiplyScalar(1 - weight).addScaledVector(p.clone().applyMatrix4(e), weight);
    maxLateralDrift = Math.max(maxLateralDrift, Math.abs(moved.x - p.x));
    maxDisplacement = Math.max(maxDisplacement, moved.distanceTo(p));
  }
  return {
    openDeg,
    vertices,
    maxLateralDrift: +maxLateralDrift.toFixed(6),
    maxDisplacement: +maxDisplacement.toFixed(2),
  };
}

/**
 * Blind-instrument check: inject a known tilt into the deformation and require the gate
 * to see it.
 *
 * The shipped defect was a 2.0899° tilt of the bone's local X away from world X, with the
 * jaw still hinging about that (tilted) axis — so the deformation was a *conjugation*
 * `R_tilt · Rx(θ) · R_tilt⁻¹`, whose axis is `R_tilt · X̂`. Composing `Rz·Rx` instead
 * tilts the resultant axis to `atan(2.09/5) = 22.7°` for a 5° opening, which is why this
 * has to be built as a conjugation and not as a pair of stacked rotations.
 *
 * This exercises the measurement half (`decompose` → axis → angle-from-X); the synthetic
 * `openDeg` check exercises the model half (`deformation`). If a refactor made either
 * return zero, the "after" numbers would read as a perfect pass — this turns that into a
 * failure instead.
 */
function selftestHingeInstrument(injectedDeg = 2.0899, openDeg = 5) {
  const radians = (deg) => (deg * Math.PI) / 180;
  const tilt = new Matrix4().makeRotationZ(radians(injectedDeg));
  const e = tilt
    .clone()
    .multiply(new Matrix4().makeRotationX(radians(openDeg)))
    .multiply(tilt.clone().invert());
  const { angle, axis } = deformationAxis(e);
  return { injectedDeg, openDeg, measuredDeg: axisVsWorldXDeg(axis), deformationDeg: angle };
}

/**
 * Structural hinge check, independent of any clip: rotate the jaw by `openDeg` about its
 * own local X from rest and ask where the world axis went.
 *
 * This is the direct statement of the C6 claim, and unlike the per-clip table it cannot
 * be masked by a clip that never opens the jaw (`takeoff` and `speed` are two-key static
 * poses, so their "widest open" frame has no rotation at all and no axis to measure).
 */
function syntheticHinge(gltf, binary, openDeg = 5) {
  const rig = createRig(gltf);
  const jawIdx = rig.nodeIndexByName.get("Jaw");
  const parent = rig.parentOf.get(jawIdx);
  const wJaw = worldOf(rig, "Jaw");
  const localRest = rig.worldMatrix(parent).clone().invert().multiply(wJaw);
  const local = localRest.clone().multiply(new Matrix4().makeRotationX((openDeg * Math.PI) / 180));
  const { angle, axis } = deformationAxis(deformation(rig, jawIdx, local));
  return { openDeg, angle, axisVsX: axisVsWorldXDeg(axis), axis: axis.toArray().map((v) => +v.toFixed(6)) };
}

/**
 * Per-clip hinge measurement: at the widest-open key, how far is the deformation's
 * rotation axis from world X, and how much jaw motion is there at all?
 *
 * Frames whose deformation is below `MIN_AXIS_DEG` are counted, not measured. A
 * quaternion's axis is `v/|v|` with `v = sin(θ/2)·axis`, so as `θ → 0` the direction is
 * float32 rounding noise — `takeoff`'s static jaw reported 5.29° of axis error off a
 * rotation too small to print. Gating on a noise axis would be a false failure; the
 * synthetic check above covers exactly the case the skip creates.
 */
function measureHinges(gltf, binary, label) {
  const rig = createRig(gltf);
  const jawIdx = rig.nodeIndexByName.get("Jaw");
  assert.ok(gltf.skins[0].joints.includes(jawIdx), "Jaw is not a skin joint");

  const rows = [];
  for (const anim of gltf.animations) {
    const find = (path) => anim.channels.find((c) => c.target.node === jawIdx && c.target.path === path);
    const rotCh = find("rotation");
    const transCh = find("translation");
    assert.ok(rotCh && transCh, `${anim.name}: Jaw rotation/translation channel missing`);

    const rot = decodeFloats(gltf, binary, anim.samplers[rotCh.sampler].output);
    const trans = decodeFloats(gltf, binary, anim.samplers[transCh.sampler].output);

    let best = null;
    let degenerate = 0;
    for (let k = 0; k * 4 < rot.length; k++) {
      const q = new Quaternion(rot[k * 4], rot[k * 4 + 1], rot[k * 4 + 2], rot[k * 4 + 3]);
      const local = new Matrix4().compose(
        new Vector3(trans[k * 3], trans[k * 3 + 1], trans[k * 3 + 2]),
        q,
        new Vector3(1, 1, 1),
      );
      const { angle, axis } = deformationAxis(deformation(rig, jawIdx, local));
      if (angle < MIN_AXIS_DEG) {
        degenerate++;
        continue;
      }
      if (!best || angle > best.deformAngle) {
        best = { deformAngle: angle, axisVsX: axisVsWorldXDeg(axis) };
      }
    }
    rows.push({
      clip: anim.name,
      deformAngle: best ? best.deformAngle : 0,
      axisVsX: best ? best.axisVsX : null,
      measuredFrames: rot.length / 4 - degenerate,
      degenerateFrames: degenerate,
    });
  }

  const measured = rows.filter((r) => r.axisVsX !== null);
  const worstAxis = measured.length ? Math.max(...measured.map((r) => r.axisVsX)) : 0;
  const maxOpen = Math.max(...rows.map((r) => r.deformAngle));
  return { label, worstAxis, maxOpen, rows, unmeasured: rows.filter((r) => r.axisVsX === null).map((r) => r.clip) };
}

/** Largest element-wise difference between two 4×4 matrices. */
function matrixDrift(a, b) {
  let worst = 0;
  for (let c = 0; c < 16; c++) worst = Math.max(worst, Math.abs(a.elements[c] - b.elements[c]));
  return worst;
}

const fmt = (v) => (typeof v === "number" ? +v.toFixed(6) : v);

/**
 * What this pass changed, field by field, against the contract currently on disk.
 *
 * The ABI half (`bones`, `roots`, `skeleton`, `skinName`, meshes, materials, textures,
 * images, clip inventory) must be *identical* — a pivot move touches none of it, so a
 * difference there means the pass went wrong and must not be re-signed.
 */
function signatureDiff(stale, fresh) {
  const identical = [];
  const changed = [];
  for (const key of ["bones", "roots", "skeleton", "skinName", "meshes", "materials",
    "textures", "samplers", "images", "extensionsUsed", "extensionsRequired"]) {
    if (JSON.stringify(stale[key]) === JSON.stringify(fresh[key])) identical.push(key);
    else changed.push(`${key}: CHANGED (should not have)`);
  }

  if (stale.bindMatrices.sha256 !== fresh.bindMatrices.sha256) {
    changed.push(`bindMatrices.sha256: ${stale.bindMatrices.sha256.slice(0, 12)}… → ${fresh.bindMatrices.sha256.slice(0, 12)}…`);
  } else identical.push("bindMatrices");

  const staleNodes = new Map(stale.nodes.map((n) => [n.name, n]));
  for (const node of fresh.nodes) {
    const old = staleNodes.get(node.name);
    if (!old) { changed.push(`nodes[${node.name}]: ADDED`); continue; }
    for (const field of ["translation", "rotation", "scale", "matrix", "children", "mesh", "skin"]) {
      if (JSON.stringify(old[field]) === JSON.stringify(node[field])) continue;
      changed.push(`nodes[${node.name}].${field}: ${JSON.stringify(old[field])} → ${JSON.stringify(node[field])}`);
    }
  }

  const staleClips = new Map(stale.clips.map((c) => [c.name, c]));
  for (const clip of fresh.clips) {
    const old = staleClips.get(clip.name);
    if (!old) { changed.push(`clips[${clip.name}]: ADDED`); continue; }
    if (JSON.stringify(old.targets) !== JSON.stringify(clip.targets)) {
      changed.push(`clips[${clip.name}].targets: CHANGED`);
    }
  }
  if (stale.clips.length !== fresh.clips.length) {
    changed.push(`clips.length: ${stale.clips.length} → ${fresh.clips.length}`);
  } else identical.push("clips (inventory + targets)");

  return { identical, changed };
}

function main() {
  const argv = process.argv.slice(2);
  const outIndex = argv.indexOf("--out");
  const outPath = outIndex >= 0 ? resolve(argv[outIndex + 1]) : null;
  const write = argv.includes("--write");
  const report = argv.includes("--report");

  const bytes = readFileSync(RUNTIME_PATH);
  const { gltf, binary } = readGlb(bytes);

  const before = measureHinges(gltf, binary, "before");
  const syntheticBefore = syntheticHinge(gltf, binary);
  const bindBefore = jawBindMap(gltf, binary);

  const rig = createRig(gltf);
  const jawIdx = rig.nodeIndexByName.get("Jaw");
  const node = gltf.nodes[jawIdx];
  assert.ok(!node.matrix, "Jaw uses a matrix node; this pass expects TRS");

  const wHead = worldOf(rig, "Head");
  const wJaw = worldOf(rig, "Jaw");
  const localOld = new Matrix4().copy(wHead).invert().multiply(wJaw);
  const qOld = new Quaternion();
  const pOld = new Vector3();
  localOld.decompose(pOld, qOld, new Vector3());

  // Target frame: local X exactly lateral, Y the current direction in the sagittal
  // plane, Z = X×Y. Same construction as the blend fix, so the two agree.
  const worldY = new Vector3().setFromMatrixColumn(wJaw, 1).normalize();
  worldY.x = 0;
  worldY.normalize();
  const worldX = new Vector3(1, 0, 0);
  const worldZ = new Vector3().crossVectors(worldX, worldY).normalize();
  const target = new Matrix4().makeBasis(worldX, worldY, worldZ);
  target.setPosition(...toGltf(MANDIBLE_BLEND));

  const localNew = new Matrix4().copy(wHead).invert().multiply(target);
  const qNew = new Quaternion();
  const pNew = new Vector3();
  localNew.decompose(pNew, qNew, new Vector3());
  const deltaLocal = new Vector3().subVectors(pNew, pOld);
  const conjugation = qmul([qNew.x, qNew.y, qNew.z, qNew.w], qinv([qOld.x, qOld.y, qOld.z, qOld.w]));

  // Running this twice must not append a second inverse bind matrix and grow the file.
  // The edit is expressed as an absolute target, so a re-run is a no-op — say so rather
  // than silently rewriting identical bytes with a duplicate provenance line.
  const alreadyAtTarget = deltaLocal.length() < 1e-4
    && Math.abs(conjugation[3]) > 1 - 1e-9
    && Math.hypot(conjugation[0], conjugation[1], conjugation[2]) < 1e-6;

  if (alreadyAtTarget) {
    console.log("Jaw is already at the C6 target (mandible joint, lateral hinge) — nothing to change.");
  } else {
    node.translation = [pNew.x, pNew.y, pNew.z];
    node.rotation = [qNew.x, qNew.y, qNew.z, qNew.w];
  }

  // ---- Inverse bind matrix + channels --------------------------------------
  const skin = gltf.skins[0];
  const jawJoint = skin.joints.indexOf(jawIdx);
  const touched = [];
  let encoded = bytes;

  if (!alreadyAtTarget) {
    const ibmAccessor = decodeAccessor(gltf, binary, skin.inverseBindMatrices);
    const bindMap = wJaw.clone().multiply(new Matrix4().fromArray(
      Array.from({ length: 16 }, (_, c) => ibmAccessor.get(jawJoint, c)),
    ));

    const ibmValues = [];
    for (let j = 0; j < ibmAccessor.count; j++) {
      if (j === jawJoint) {
        const updated = target.clone().invert().multiply(bindMap);
        ibmValues.push(...updated.elements);
      } else {
        for (let c = 0; c < 16; c++) ibmValues.push(ibmAccessor.get(j, c));
      }
    }
    const appendor = makeAppendor(gltf, binary);
    skin.inverseBindMatrices = appendor.appendFloats(ibmValues, "MAT4");

    for (const anim of gltf.animations) {
      const rotCh = anim.channels.find((c) => c.target.node === jawIdx && c.target.path === "rotation");
      const transCh = anim.channels.find((c) => c.target.node === jawIdx && c.target.path === "translation");
      assert.ok(rotCh && transCh, `${anim.name}: Jaw rotation/translation channel missing`);

      const rotSampler = anim.samplers[rotCh.sampler];
      const rot = decodeFloats(gltf, binary, rotSampler.output);
      const conjugated = [];
      for (let k = 0; k * 4 < rot.length; k++) {
        conjugated.push(...qnorm(qmul(conjugation, rot.slice(k * 4, k * 4 + 4))));
      }
      // In place when the accessor is a plain tight float array; only then do the file
      // size and the accessor indices stay put.
      const rotInPlace = writeFloatsInPlace(gltf, binary, rotSampler.output, conjugated);
      if (!rotInPlace) rotSampler.output = appendor.appendFloats(conjugated, "VEC4");

      const transSampler = anim.samplers[transCh.sampler];
      const trans = decodeFloats(gltf, binary, transSampler.output);
      const shifted = [];
      for (let k = 0; k * 3 < trans.length; k++) {
        shifted.push(
          trans[k * 3] + deltaLocal.x,
          trans[k * 3 + 1] + deltaLocal.y,
          trans[k * 3 + 2] + deltaLocal.z,
        );
      }
      const transInPlace = writeFloatsInPlace(gltf, binary, transSampler.output, shifted);
      if (!transInPlace) transSampler.output = appendor.appendFloats(shifted, "VEC3");

      touched.push({
        clip: anim.name,
        rotationKeys: conjugated.length / 4,
        translationKeys: shifted.length / 3,
        inPlace: rotInPlace && transInPlace,
      });
    }

    encoded = encodeGlb(gltf, appendor.finish());
  }

  // ---- Verify --------------------------------------------------------------
  const { gltf: check, binary: checkBin } = readGlb(encoded);
  const after = measureHinges(check, checkBin, "after");
  const syntheticAfter = syntheticHinge(check, checkBin);

  // The contract on disk still describes the pre-C6 asset, so this pass builds the
  // signature instead of asserting against it. `inspectRuntimeRig` still enforces every
  // structural invariant — bone ABI vs the Gothic source contract, one skin, unit
  // weights, clip inventory, sampler/key counts — and the diff below is the review
  // record that has to be re-signed.
  const signature = inspectRuntimeRig(encoded);
  const sha256 = createHash("sha256").update(encoded).digest("hex");
  const stale = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")).signature;
  const diff = signatureDiff(stale, signature);

  // The hinge gate cannot see the bind matrix, so it is checked directly:
  // `W_new · IBM_new` must still equal the old bind map, or the whole mesh shifts at bind.
  const bindDrift = matrixDrift(bindBefore, jawBindMap(check, checkBin));
  const pivotMoved = new Vector3(
    wJaw.elements[12], wJaw.elements[13], wJaw.elements[14],
  ).distanceTo(new Vector3(...toGltf(MANDIBLE_BLEND)));

  const failures = [];
  if (syntheticAfter.axisVsX > AXIS_TOLERANCE_DEG) {
    failures.push(`synthetic ${syntheticAfter.openDeg}deg hinge axis ${syntheticAfter.axisVsX.toFixed(4)}deg off world X > ${AXIS_TOLERANCE_DEG}deg`);
  }
  if (after.worstAxis > AXIS_TOLERANCE_DEG) {
    failures.push(`clip hinge axis ${after.worstAxis.toFixed(4)}deg off world X > ${AXIS_TOLERANCE_DEG}deg`);
  }
  if (!after.rows.some((r) => r.axisVsX !== null)) {
    failures.push("every clip was skipped as degenerate — the clip gate measured nothing");
  }
  if (bindDrift > BIND_TOLERANCE) failures.push(`bind map drift ${bindDrift} > ${BIND_TOLERANCE}`);
  if (diff.changed.some((line) => line.includes("should not have"))) failures.push("ABI changed");
  const selftest = selftestHingeInstrument();
  const vertexDrift = jawVertexLateralDrift(check, checkBin);
  if (vertexDrift.maxLateralDrift > LATERAL_TOLERANCE) {
    failures.push(
      `jaw vertices drift ${vertexDrift.maxLateralDrift} sideways at ${vertexDrift.openDeg}deg open > ${LATERAL_TOLERANCE}`,
    );
  }
  if (vertexDrift.vertices === 0) failures.push("no fully jaw-weighted vertices found — the vertex gate measured nothing");
  if (Math.abs(selftest.measuredDeg - selftest.injectedDeg) > 0.01) {
    failures.push(
      `blind instrument: injected a ${selftest.injectedDeg}deg hinge tilt, the gate measured ${selftest.measuredDeg.toFixed(4)}deg`,
    );
  }

  const summary = {
    jaw: {
      worldBefore: [wJaw.elements[12], wJaw.elements[13], wJaw.elements[14]].map((v) => +v.toFixed(3)),
      worldAfter: toGltf(MANDIBLE_BLEND).map((v) => +v.toFixed(3)),
      pivotMovedUnits: +pivotMoved.toFixed(3),
      localTranslationDelta: +pNew.distanceTo(pOld).toFixed(3),
      localRotationDeltaDeg: +quatAxisAngleDeg(
        new Quaternion(...[qOld.x, qOld.y, qOld.z, qOld.w]).invert().premultiply(qNew),
      ).angle.toFixed(4),
    },
    hinge: {
      syntheticAxisVsWorldXBefore: +syntheticBefore.axisVsX.toFixed(4),
      syntheticAxisVsWorldXAfter: +syntheticAfter.axisVsX.toFixed(4),
      worstClipAxisVsWorldXBefore: +before.worstAxis.toFixed(4),
      worstClipAxisVsWorldXAfter: +after.worstAxis.toFixed(4),
      maxOpenBefore: +before.maxOpen.toFixed(3),
      maxOpenAfter: +after.maxOpen.toFixed(3),
      unmeasuredClips: after.unmeasured,
      bindMapDrift: +bindDrift.toExponential(3),
    },
    channelsTouched: touched.length,
    channelsWrittenInPlace: touched.filter((t) => t.inPlace).length,
    bytes: encoded.length,
    bytesBefore: bytes.length,
    sha256,
    joints: signature.bones.length,
    clips: signature.clips.length,
    contractDiff: diff,
    selftest,
    jawVertices: vertexDrift,
    gates: failures.length ? { passed: false, failures } : { passed: true },
  };

  console.log(JSON.stringify(summary, null, 2));

  if (report) {
    const byClip = new Map(before.rows.map((r) => [r.clip, r]));
    console.log("\nclip          open(deg)   axis-vs-X(deg)   frames");
    console.log("                            before    after  measured/skipped");
    for (const row of after.rows) {
      const old = byClip.get(row.clip);
      const axis = row.axisVsX === null ? "  n/a" : row.axisVsX.toFixed(4).padStart(8);
      const oldAxis = old.axisVsX === null ? "  n/a" : old.axisVsX.toFixed(4).padStart(8);
      console.log(
        `  ${row.clip.padEnd(12)} ${row.deformAngle.toFixed(2).padStart(6)}   ${oldAxis} ${axis}` +
        `   ${String(row.measuredFrames).padStart(3)}/${String(row.degenerateFrames).padEnd(3)}`,
      );
    }
    console.log(`\nsynthetic ${syntheticAfter.openDeg}deg about local X → axis ${syntheticAfter.axis.join(", ")}`);
  }

  if (failures.length) {
    console.error(`\nFAILED: ${failures.join("; ")}`);
    process.exitCode = 1;
  }

  if (write) {
    if (alreadyAtTarget) {
      console.log("\nnothing to write — the shipped asset is already at the C6 target");
      return;
    }
    if (failures.length) {
      console.error("\nrefusing to re-pin: the gates above did not pass");
      return;
    }

    // Prove the re-signed contract will validate *before* touching either file.
    const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));
    contract.signature = signature;
    contract.asset.sha256 = sha256;
    contract.asset.bytes = encoded.length;
    const stamp = new Date().toISOString().slice(0, 10);
    contract.provenance.baseline =
      `${stamp}: Jaw hinge pivot moved from the ${pivotMoved.toFixed(1)}-units-high stub to the mandible joint ` +
      `(tools/blender/recenter_v2_jaw_pivot.mjs; blend side is stage C6). Node rest TRS, the Jaw inverse bind ` +
      `matrix and all 18 clips' Jaw rotation/translation channels; no other field changed. ` +
      `Hinge axis 2.0899deg -> ${syntheticAfter.axisVsX.toFixed(4)}deg off world X. ${contract.provenance.baseline}`;
    contract.provenance.evidence =
      `assets/rig-audits/2026-10-22-c6-jaw-pivot/runtime-jaw-pivot.json; ${contract.provenance.evidence}`;
    validateRuntimeRig(encoded, { contract });

    const temporary = `${RUNTIME_PATH}.c6-jaw-pivot.tmp`;
    try {
      writeFileSync(temporary, encoded);
      renameSync(temporary, RUNTIME_PATH);
    } finally {
      rmSync(temporary, { force: true });
    }
    writeFileSync(CONTRACT_PATH, `${JSON.stringify(contract, null, 2)}\n`);
    for (const alias of CANDIDATE_ALIASES) writeFileSync(alias, encoded);

    // Re-read from disk: the bytes that will actually ship, against the pin on disk.
    const final = validateRuntimeRig(readFileSync(RUNTIME_PATH));
    console.log(`\nre-pinned ${RUNTIME_PATH}`);
    console.log(`re-signed ${CONTRACT_PATH}`);
    console.log(`synced ${CANDIDATE_ALIASES.length} candidate aliases`);
    console.log(JSON.stringify(final, null, 2));
  } else if (outPath) {
    writeFileSync(outPath, encoded);
    console.log(`\nwrote candidate ${outPath}`);
  } else {
    console.log("\ndry run (pass --out <path> or --write)");
  }
}

main();
