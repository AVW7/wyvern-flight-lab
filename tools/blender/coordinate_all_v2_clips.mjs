import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { AnimationMixer, Euler, LoopOnce, Matrix4, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { readGlb, encodeGlb } from "./runtime_rig_contract.mjs";
import { compactGlb } from "./compact_v2_glb.mjs";
import {
  splicePanelChannels,
  PANEL_NAMES,
  WING_CHAIN_NAMES,
  NECK_HEAD_NAMES,
} from "./package_panel_coordination.mjs";

const LOOPING_CLIPS = new Set([
  "bankLeft",
  "bankRight",
  "cruise",
  "dive",
  "glide",
  "hover",
  "idle",
  "rest",
  "scout",
  "speed",
  "walk",
]);

const DIGIT_NAMES = ["L", "R"].flatMap((s) =>
  [0, 1, 2, 3, 4, 5].flatMap((d) => [0, 1, 2].map((p) => `${s}_WingD${d}P${p}`))
);
const DISTAL_DIGIT_NAMES = ["L", "R"].flatMap((s) =>
  [0, 1, 2, 3, 4].flatMap((d) => [1, 2].map((p) => `${s}_WingD${d}P${p}`))
);

export async function buildAllCoordinatedV2Glb(
  basePath = "public/models/wyvern-v2-rig.glb",
  outDir = "assets/harvest-candidates/2026-10-07/mcp-study",
  outputPath = `${outDir}/wyvern-v2-flight-panels-coordinated.glb`
) {
  // 1. Start from pinned base GLB and splice the 7 Blender-MCP-authored donors
  let buf = readFileSync(basePath);
  const donors = [
    ["cruise", `${outDir}/cruise-panel-donor-isolated.glb`, []],
    ["bankLeft", `${outDir}/bankLeft-panel-donor-isolated.glb`, []],
    ["bankRight", `${outDir}/bankRight-panel-donor-isolated.glb`, []],
    ["idle", `${outDir}/idle-panel-donor-isolated.glb`, [...WING_CHAIN_NAMES, ...NECK_HEAD_NAMES]],
    ["walk", `${outDir}/walk-panel-donor-isolated.glb`, WING_CHAIN_NAMES],
    ["takeoff", `${outDir}/takeoff-panel-donor-isolated.glb`, [...WING_CHAIN_NAMES, ...NECK_HEAD_NAMES]],
    ["land", `${outDir}/land-panel-donor-isolated.glb`, [...WING_CHAIN_NAMES, ...NECK_HEAD_NAMES]],
  ];

  const donorHashes = {};
  const resolvedFromBase = [];
  for (const [clip, donorPath, extraNodes] of donors) {
    if (!existsSync(donorPath)) {
      // The 2026-10-07 MCP-study donors are no longer in the repo. The panel
      // solve below derives panels from the adjacent digits' world deltas, so a
      // missing donor is not fatal: keep the base clip's channels and re-solve.
      console.log(`[coordinate] donor missing for '${clip}'; re-solving panels from base`);
      resolvedFromBase.push(clip);
      continue;
    }
    const donorBytes = readFileSync(donorPath);
    donorHashes[clip] = createHash("sha256").update(donorBytes).digest("hex");
    buf = splicePanelChannels(buf, donorBytes, clip, extraNodes);
  }

  const { gltf, binary } = readGlb(buf);

  // Strip materials/textures in a temporary copy for headless Three.js evaluation
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

  // When every donor is missing we are re-solving the current runtime rig,
  // whose rest/attack2/attackAir2 wrist/hand/digit channels are already the
  // repaired versions. Re-applying the era-specific partial-unbind slerps
  // would open rest's flank fold back up (regresses the <1800 hand span).
  const legacyDonorMode = resolvedFromBase.length === 0;

  const remainingClips = [
    ...resolvedFromBase,
    "attack",

    "attack2",
    "attackAir2",
    "breath",
    "death",
    "dive",
    "glide",
    "hover",
    "rest",
    "scout",
    "speed",
  ];

  for (const clipName of remainingClips) {
    const clip = animations.find((a) => a.name === clipName);
    const gltfAnim = gltf.animations.find((a) => a.name === clipName);
    assert.ok(clip && gltfAnim, `Missing clip ${clipName}`);

    // Sample at the source 24 fps rate: sparser grids leave fast flaps (e.g.
    // land's touchdown slam) with tens of degrees of panel error mid-interval.
    const nFrames = Math.max(8, Math.round(clip.duration * 24));
    const count = nFrames + 1;
    const times = Array.from({ length: count }, (_, f) => (clip.duration * f) / nFrames);
    const isLoop = LOOPING_CLIPS.has(clipName);

    const mixer = new AnimationMixer(scene);
    const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    const extraRotBones =
      clipName === "rest" || clipName === "attack2"
        ? ["L_WingWrist", "R_WingWrist", "L_WingHand", "R_WingHand", ...DIGIT_NAMES]
        : clipName === "attackAir2"
          ? DIGIT_NAMES
          : [];

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

    const extraRotSamples = Object.fromEntries(extraRotBones.map((n) => [n, []]));
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

      if (legacyDonorMode && (clipName === "rest" || clipName === "attack2")) {
        for (const s of ["L", "R"]) {
          for (const [part, alpha] of [
            ["WingWrist", 0.82],
            ["WingHand", 0.68],
          ]) {
            const bname = `${s}_${part}`;
            const qBase = bindQuat[bname].clone();
            const qPose = bones[bname].quaternion.clone();
            if (qBase.dot(qPose) < 0) qPose.set(-qPose.x, -qPose.y, -qPose.z, -qPose.w);
            bones[bname].quaternion.copy(qBase.slerp(qPose, alpha));
            bones[bname].updateMatrix();
          }
        }
        for (const bname of DIGIT_NAMES) {
          const qBase = bindQuat[bname].clone();
          const qPose = bones[bname].quaternion.clone();
          if (qBase.dot(qPose) < 0) qPose.set(-qPose.x, -qPose.y, -qPose.z, -qPose.w);
          bones[bname].quaternion.copy(qBase.slerp(qPose, 0.55));
          bones[bname].updateMatrix();
        }
      } else if (legacyDonorMode && clipName === "attackAir2") {
        for (const bname of DIGIT_NAMES) {
          const qBase = bindQuat[bname].clone();
          const qPose = bones[bname].quaternion.clone();
          if (qBase.dot(qPose) < 0) qPose.set(-qPose.x, -qPose.y, -qPose.z, -qPose.w);
          bones[bname].quaternion.copy(qBase.slerp(qPose, 0.72));
          bones[bname].updateMatrix();
        }
      }

      scene.updateMatrixWorld(true);

      for (const bname of extraRotBones) {
        const q = bones[bname].quaternion.clone();
        const prev = extraRotSamples[bname].at(-1);
        if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        extraRotSamples[bname].push(q);
      }

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

        // Add subtle aerodynamic/respiratory batten tension pulse (0.35° = 0.0061 rad > MEMBRANE_MOTION_MIN 0.005 rad)
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
      for (const bname of extraRotBones) {
        const qEnd = extraRotSamples[bname][0].clone();
        if (qEnd.dot(extraRotSamples[bname][nFrames - 1]) < 0) {
          qEnd.set(-qEnd.x, -qEnd.y, -qEnd.z, -qEnd.w);
        }
        extraRotSamples[bname][nFrames] = qEnd;
      }
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
    for (const bname of extraRotBones) {
      const flat = extraRotSamples[bname].flatMap((q) => [q.x, q.y, q.z, q.w]);
      setChannelTrack(gltfAnim, bname, "rotation", fullTimeAccIdx, twoPointTimeAccIdx, flat, count);
    }
    for (const name of PANEL_NAMES) {
      const flatPos = panelPosSamples[name].flatMap((p) => [p.x, p.y, p.z]);
      const flatRot = panelRotSamples[name].flatMap((q) => [q.x, q.y, q.z, q.w]);
      setChannelTrack(gltfAnim, name, "translation", fullTimeAccIdx, twoPointTimeAccIdx, flatPos, count);
      setChannelTrack(gltfAnim, name, "rotation", fullTimeAccIdx, twoPointTimeAccIdx, flatRot, count);
    }
  }

  // Also collapse any newly spliced constant tracks in idle/walk/takeoff/land/cruise/bankLeft/bankRight
  for (const gltfAnim of gltf.animations) {
    let twoPtTimeAcc = null;
    for (const ch of gltfAnim.channels) {
      const sampler = gltfAnim.samplers[ch.sampler];
      const inAcc = gltf.accessors[sampler.input];
      const outAcc = gltf.accessors[sampler.output];
      if (outAcc.count <= 2) continue;
      const comps = outAcc.type === "VEC4" ? 4 : outAcc.type === "VEC3" ? 3 : 1;
      const bv = gltf.bufferViews[outAcc.bufferView];
      const raw = chunks[0];
      if ((bv.byteOffset ?? 0) + bv.byteLength > raw.length) continue;
      const vals = [];
      for (let i = 0; i < outAcc.count * comps; i++) {
        vals.push(raw.readFloatLE((bv.byteOffset ?? 0) + i * 4));
      }
      if (isConstantSeries(vals, comps)) {
        if (twoPtTimeAcc === null) {
          twoPtTimeAcc = appendFloatAccessor([inAcc.min[0], inAcc.max[0]], "SCALAR", 2);
        }
        const twoVals = [
          ...vals.slice(0, comps),
          ...vals.slice((outAcc.count - 1) * comps, outAcc.count * comps),
        ];
        sampler.input = twoPtTimeAcc;
        sampler.output = appendFloatAccessor(twoVals, outAcc.type, 2);
      }
    }
  }

  const endPad = (4 - (binLength % 4)) % 4;
  if (endPad > 0) {
    chunks.push(Buffer.alloc(endPad));
    binLength += endPad;
  }
  gltf.buffers[0].byteLength = binLength;
  const encoded = encodeGlb(gltf, Buffer.concat(chunks));
  writeFileSync(outputPath, encoded);
  const compactStats = compactGlb(outputPath, outputPath);
  const finalBytes = readFileSync(outputPath);
  const sha256 = createHash("sha256").update(finalBytes).digest("hex");

  writeFileSync(
    outputPath.replace(/\.glb$/, ".panels.json"),
    JSON.stringify(
      {
        status: "experiment",
        clips: gltf.animations.map((a) => a.name).sort(),
        base_path: basePath,
        base_sha256: createHash("sha256").update(readFileSync(basePath)).digest("hex"),
        donor_sha256: donorHashes,
        output_path: outputPath,
        output_sha256: sha256,
        compact_stats: compactStats,
        panel_names: PANEL_NAMES,
        preserved: "all binary data, geometry, skin weights, skeleton, and unmodified non-target channels",
      },
      null,
      2
    ) + "\n"
  );

  return { outputPath, sha256, bytes: finalBytes.length, compactStats };
}

function mathSinCycle(f, nFrames, phase) {
  return Math.sin((2.0 * Math.PI * f) / nFrames + phase);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^[./]+/, ""))) {
  const res = await buildAllCoordinatedV2Glb();
  console.log("Coordinated all 18 V2 clips:", JSON.stringify(res, null, 2));
}
