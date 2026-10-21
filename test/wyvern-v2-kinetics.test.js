import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AnimationMixer, Euler, LoopOnce, LoopRepeat, Matrix4, Quaternion, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { createWyvernFlightRig } from "../src/flight-lab/rig/wyvernFlightRig.ts";

async function loadWyvernV2Scene() {
  const glbPath = process.env.WYVERN_V2_GLB_PATH || new URL("../public/models/wyvern-v2-rig.glb", import.meta.url);
  const bytes = readFileSync(glbPath);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));

  if (json.meshes) {
    for (const mesh of json.meshes) {
      if (mesh.primitives) {
        for (const primitive of mesh.primitives) delete primitive.material;
      }
    }
  }
  delete json.materials;
  delete json.images;
  delete json.textures;

  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32);
  encoded.copy(padded);
  const binary = bytes.subarray(20 + jsonLength);
  const output = Buffer.alloc(20 + padded.length + binary.length);
  bytes.copy(output, 0, 0, 20);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12);
  padded.copy(output, 20);
  binary.copy(output, 20 + padded.length);

  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
    output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength),
    ""
  );
}

function findBone(scene, name) {
  let matched;
  scene.traverse((obj) => {
    if (obj.isBone && obj.name === name) matched = obj;
  });
  return matched;
}

test("wyvern v2 rig: contains required leg and caudal bones", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  const requiredBones = [
    "L_Thigh", "L_Calf", "L_Foot", "L_Toes",
    "R_Thigh", "R_Calf", "R_Foot", "R_Toes",
    "Tail1", "Tail2", "Tail3", "Tail4", "Tail5",
    "Tail6", "Tail7", "Tail8", "Tail9", "Tail10",
    "Spine1", "Spine2", "Spine3", "Body", "Head"
  ];

  for (const boneName of requiredBones) {
    const bone = findBone(scene, boneName);
    assert.ok(bone, `Rig must contain required bone: ${boneName}`);
  }
});

test("wyvern v2 rig: preserves single shared skin invariant without duplicate skins", async () => {
  const bytes = readFileSync(new URL("../public/models/wyvern-v2-rig.glb", import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));

  // Must have exactly 1 skin (no duplicate skins)
  assert.equal(json.skins?.length, 1, `Wyvern V2 model must have exactly 1 skin, got ${json.skins?.length}`);
  assert.equal(json.skins[0].joints?.length, 92, `Shared skin must have exactly 92 joints`);
  assert.equal(json.skins[0].name, "WyvernRig", `Shared skin name must be WyvernRig`);

  // Both WyvernBody_Rebuild and WyvernMembrane_ExportSafe must bind to skin 0
  const skinnedNodes = json.nodes.filter((n) => n.skin !== undefined);
  assert.equal(skinnedNodes.length, 2, `Both body and membrane nodes must be skinned`);
  for (const node of skinnedNodes) {
    assert.equal(node.skin, 0, `Node ${node.name} must reference shared skin 0 without duplicate skins`);
  }
});

test("wyvern v2 rig: contains complete 60-bone wing skeleton across digits and membrane panels", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  const wingBones = [
    "L_WingShoulder", "L_WingElbow", "L_WingWrist", "L_WingHand",
    "L_WingD0P0", "L_WingD0P1", "L_WingD0P2",
    "L_WingD1P0", "L_WingD1P1", "L_WingD1P2",
    "L_WingD2P0", "L_WingD2P1", "L_WingD2P2",
    "L_WingD3P0", "L_WingD3P1", "L_WingD3P2",
    "L_WingD4P0", "L_WingD4P1", "L_WingD4P2",
    "L_WingD5P0", "L_WingD5P1", "L_WingD5P2",
    "L_WingPanel0_0", "L_WingPanel0_1",
    "L_WingPanel1_0", "L_WingPanel1_1",
    "L_WingPanel2_0", "L_WingPanel2_1",
    "L_WingPanel3_0", "L_WingPanel3_1",
    "R_WingShoulder", "R_WingElbow", "R_WingWrist", "R_WingHand",
    "R_WingD0P0", "R_WingD0P1", "R_WingD0P2",
    "R_WingD1P0", "R_WingD1P1", "R_WingD1P2",
    "R_WingD2P0", "R_WingD2P1", "R_WingD2P2",
    "R_WingD3P0", "R_WingD3P1", "R_WingD3P2",
    "R_WingD4P0", "R_WingD4P1", "R_WingD4P2",
    "R_WingD5P0", "R_WingD5P1", "R_WingD5P2",
    "R_WingPanel0_0", "R_WingPanel0_1",
    "R_WingPanel1_0", "R_WingPanel1_1",
    "R_WingPanel2_0", "R_WingPanel2_1",
    "R_WingPanel3_0", "R_WingPanel3_1",
  ];

  for (const boneName of wingBones) {
    const bone = findBone(scene, boneName);
    assert.ok(bone, `Rig must contain required wing bone: ${boneName}`);
  }
});

test("wyvern v2 kinetics: walk clip demonstrates alternating stance and swing ground clearance", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;
  const walkClip = gltf.animations.find((a) => a.name === "walk");
  assert.ok(walkClip, "walk clip must exist on V2 rig");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(walkClip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const lFoot = findBone(scene, "L_Foot");
  const rFoot = findBone(scene, "R_Foot");
  assert.ok(lFoot && rFoot, "Foot bones must bind");

  const sampleCount = 48;
  const lHeights = [];
  const rHeights = [];

  for (let i = 0; i <= sampleCount; i++) {
    mixer.setTime((walkClip.duration * i) / sampleCount);
    scene.updateMatrixWorld(true);
    const lPos = new Vector3();
    const rPos = new Vector3();
    lFoot.getWorldPosition(lPos);
    rFoot.getWorldPosition(rPos);
    lHeights.push(lPos.y);
    rHeights.push(rPos.y);
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  const minL = Math.min(...lHeights);
  const maxL = Math.max(...lHeights);
  const minR = Math.min(...rHeights);
  const maxR = Math.max(...rHeights);

  // Both feet must exhibit swing clearance (> 5 model units above stance minimum)
  const leftSwingClearance = maxL - minL;
  const rightSwingClearance = maxR - minR;
  assert.ok(
    leftSwingClearance > 5,
    `Left foot must show swing clearance, got ${leftSwingClearance}`
  );
  assert.ok(
    rightSwingClearance > 5,
    `Right foot must show swing clearance, got ${rightSwingClearance}`
  );

  // Stance floor levels must match between left and right feet within 3 model units (~0.3% body span)
  const floorDelta = Math.abs(minL - minR);
  assert.ok(
    floorDelta < 3.0,
    `Stance floor levels must be symmetric between left (${minL}) and right (${minR}), delta ${floorDelta}`
  );
});

test("wyvern v2 kinetics: cruise flight tuck maintains bilateral leg symmetry and avoids floor dragging", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;
  const cruiseClip = gltf.animations.find((a) => a.name === "cruise");
  assert.ok(cruiseClip, "cruise clip must exist on V2 rig");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(cruiseClip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const lFoot = findBone(scene, "L_Foot");
  const rFoot = findBone(scene, "R_Foot");
  const body = findBone(scene, "Body") || findBone(scene, "Spine1");
  assert.ok(lFoot && rFoot && body, "Bones must bind");

  const sampleCount = 48;
  let maxFootAsymmetry = 0;

  for (let i = 0; i <= sampleCount; i++) {
    mixer.setTime((cruiseClip.duration * i) / sampleCount);
    scene.updateMatrixWorld(true);

    const lPos = new Vector3();
    const rPos = new Vector3();
    const bodyPos = new Vector3();
    lFoot.getWorldPosition(lPos);
    rFoot.getWorldPosition(rPos);
    body.getWorldPosition(bodyPos);

    // Legs must be tucked within body envelope (less than 350 model units below body center)
    const lDrop = bodyPos.y - lPos.y;
    const rDrop = bodyPos.y - rPos.y;
    assert.ok(lDrop < 350, `Left foot dangling below flight tuck envelope: drop=${lDrop}`);
    assert.ok(rDrop < 350, `Right foot dangling below flight tuck envelope: drop=${rDrop}`);

    const deltaY = Math.abs(lPos.y - rPos.y);
    if (deltaY > maxFootAsymmetry) maxFootAsymmetry = deltaY;
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  // In cruise, bilateral symmetry of feet must stay tight (< 15 model units difference across stroke)
  assert.ok(
    maxFootAsymmetry < 15,
    `Bilateral leg asymmetry exceeded threshold in cruise: ${maxFootAsymmetry} units`
  );
});

test("wyvern v2 kinetics: flight rig runtime preserves stable leg tuck across 120 frames without wheel-spinning accumulation", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;
  const cruiseClip = gltf.animations.find((a) => a.name === "cruise");
  assert.ok(cruiseClip, "cruise clip must exist on V2 rig");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(cruiseClip).setLoop(LoopRepeat);
  action.play();

  const flightRig = createWyvernFlightRig(scene);
  const lThigh = findBone(scene, "L_Thigh");
  const rThigh = findBone(scene, "R_Thigh");
  const lFoot = findBone(scene, "L_Foot");
  const rFoot = findBone(scene, "R_Foot");
  const lToes = findBone(scene, "L_Toes");
  const rToes = findBone(scene, "R_Toes");
  assert.ok(lThigh && rThigh && lFoot && rFoot && lToes && rToes, "Bones must bind");

  const dt = 1 / 60;
  const thighAngles = [];
  const toeAngles = [];
  for (let frame = 0; frame <= 120; frame++) {
    mixer.update(dt);
    flightRig.update({
      horizontalSpeed: 18,
      verticalSpeed: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 5.45,
      isMouthActionActive: false,
    }, null, dt);

    const q = lThigh.quaternion;
    // Track Euler angle X to detect flipping
    const e = new Euler().setFromQuaternion(q, "XYZ");
    thighAngles.push(e.x * 180 / Math.PI);

    const toeE = new Euler().setFromQuaternion(lToes.quaternion, "XYZ");
    toeAngles.push(toeE.x * 180 / Math.PI);
  }

  // Pitch must stay bounded between -90° and -50° across all 120 frames (no wheel spinning)
  const minAngle = Math.min(...thighAngles);
  const maxAngle = Math.max(...thighAngles);
  assert.ok(
    minAngle > -95 && maxAngle < -50,
    `Leg pitch rotated like a wheel: range was [${minAngle.toFixed(1)}°, ${maxAngle.toFixed(1)}°]`
  );
  // Drift between frame 60 and 120 must be < 0.5°
  const drift = Math.abs(thighAngles[120] - thighAngles[60]);
  assert.ok(drift < 0.5, `Leg pitch drifted over time: drift=${drift.toFixed(2)}°`);

  // Toes must also maintain aerodynamic talon tuck without rotational drift
  const toeMin = Math.min(...toeAngles);
  const toeMax = Math.max(...toeAngles);
  assert.ok(
    toeMax - toeMin < 15,
    `Toe pitch flutter bounded: range was [${toeMin.toFixed(1)}°, ${toeMax.toFixed(1)}°]`
  );
  const toeDrift = Math.abs(toeAngles[120] - toeAngles[60]);
  assert.ok(toeDrift < 0.5, `Toe pitch drifted over time: drift=${toeDrift.toFixed(2)}°`);
});

test("wyvern v2 kinetics: tail chain maintains loop continuity without angular seam snaps", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;
  const cruiseClip = gltf.animations.find((a) => a.name === "cruise");
  assert.ok(cruiseClip, "cruise clip must exist");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(cruiseClip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const tailRoot = findBone(scene, "Tail1");
  const tailMid = findBone(scene, "Tail5");
  const tailTip = findBone(scene, "Tail10");
  assert.ok(tailRoot && tailMid && tailTip, "Tail bones must bind");

  mixer.setTime(0);
  scene.updateMatrixWorld(true);
  const rootQ0 = tailRoot.getWorldQuaternion(new Quaternion());
  const midQ0 = tailMid.getWorldQuaternion(new Quaternion());
  const tipQ0 = tailTip.getWorldQuaternion(new Quaternion());

  mixer.setTime(cruiseClip.duration);
  scene.updateMatrixWorld(true);
  const rootQEnd = tailRoot.getWorldQuaternion(new Quaternion());
  const midQEnd = tailMid.getWorldQuaternion(new Quaternion());
  const tipQEnd = tailTip.getWorldQuaternion(new Quaternion());

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  const seamRootDeg = (rootQ0.angleTo(rootQEnd) * 180) / Math.PI;
  const seamMidDeg = (midQ0.angleTo(midQEnd) * 180) / Math.PI;
  const seamTipDeg = (tipQ0.angleTo(tipQEnd) * 180) / Math.PI;

  // Maximum seam tolerance: < 1.0 degree across all caudal segments
  assert.ok(seamRootDeg < 1.0, `Tail root seam snapped by ${seamRootDeg}°`);
  assert.ok(seamMidDeg < 1.0, `Tail mid seam snapped by ${seamMidDeg}°`);
  assert.ok(seamTipDeg < 1.0, `Tail tip seam snapped by ${seamTipDeg}°`);
});

test("wyvern v2 kinetics: takeoff and land clips exhibit dynamic push-off and landing impact absorption", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;
  const takeoffClip = gltf.animations.find((a) => a.name === "takeoff");
  const landClip = gltf.animations.find((a) => a.name === "land");
  assert.ok(takeoffClip && landClip, "takeoff and land clips must exist on V2 rig");

  const lFoot = findBone(scene, "L_Foot");
  const body = findBone(scene, "Body");
  assert.ok(lFoot && body, "L_Foot and Body must bind");

  // In takeoff: legs crouch/compress downward relative to body to generate push-off force
  const mixer = new AnimationMixer(scene);
  const takeoffAction = mixer.clipAction(takeoffClip).setLoop(LoopOnce, 1);
  takeoffAction.clampWhenFinished = true;
  takeoffAction.play();

  const takeoffSamples = [];
  for (let i = 0; i <= 10; i++) {
    mixer.setTime((takeoffClip.duration * i) / 10);
    scene.updateMatrixWorld(true);
    const fp = new Vector3();
    const bp = new Vector3();
    lFoot.getWorldPosition(fp);
    body.getWorldPosition(bp);
    takeoffSamples.push(fp.y - bp.y);
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  const initialTakeoffRelY = takeoffSamples[0];
  const maxCompressionRelY = Math.min(...takeoffSamples);
  const pushOffCompression = initialTakeoffRelY - maxCompressionRelY;

  // Takeoff crouch compression must exceed 15 model units
  assert.ok(
    pushOffCompression > 15,
    `Takeoff must execute leg push-off compression stroke, got delta ${pushOffCompression}`
  );

  // In land: legs extend downward from flight posture to absorb touchdown impact
  const landAction = mixer.clipAction(landClip).setLoop(LoopOnce, 1);
  landAction.clampWhenFinished = true;
  landAction.play();

  const landSamples = [];
  for (let i = 0; i <= 10; i++) {
    mixer.setTime((landClip.duration * i) / 10);
    scene.updateMatrixWorld(true);
    const fp = new Vector3();
    const bp = new Vector3();
    lFoot.getWorldPosition(fp);
    body.getWorldPosition(bp);
    landSamples.push(fp.y - bp.y);
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  const initialFlightRelY = landSamples[0];
  const maxReachRelY = Math.min(...landSamples);
  const landingReachStroke = initialFlightRelY - maxReachRelY;

  // Landing leg extension stroke must reach downward by > 50 model units to meet ground
  assert.ok(
    landingReachStroke > 50,
    `Landing must extend feet downward to absorb ground impact, got delta ${landingReachStroke}`
  );
});

test("wyvern v2 kinetics: tail wave propagates progressively from root to tip in cruise", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;
  const cruiseClip = gltf.animations.find((a) => a.name === "cruise");
  assert.ok(cruiseClip, "cruise clip must exist");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(cruiseClip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const tailRoot = findBone(scene, "Tail1");
  const tailTip = findBone(scene, "Tail10");
  assert.ok(tailRoot && tailTip, "Tail bones must bind");

  const sampleCount = 60;
  const rootLateralX = [];
  const tipLateralX = [];

  for (let i = 0; i <= sampleCount; i++) {
    mixer.setTime((cruiseClip.duration * i) / sampleCount);
    scene.updateMatrixWorld(true);
    const rPos = new Vector3();
    const tPos = new Vector3();
    tailRoot.getWorldPosition(rPos);
    tailTip.getWorldPosition(tPos);
    rootLateralX.push(rPos.x);
    tipLateralX.push(tPos.x);
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  // Tip lateral excursion must exceed root excursion (whip dynamic / amplitude amplification)
  const rootSpan = Math.max(...rootLateralX) - Math.min(...rootLateralX);
  const tipSpan = Math.max(...tipLateralX) - Math.min(...tipLateralX);

  assert.ok(
    tipSpan > rootSpan,
    `Tail tip amplitude (${tipSpan}) must exceed base root amplitude (${rootSpan})`
  );
});

test("wyvern v2 kinetics: jaw remains closed during cruise without 180-degree inversion flips", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;
  const cruiseClip = gltf.animations.find((a) => a.name === "cruise");
  assert.ok(cruiseClip, "cruise clip must exist");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(cruiseClip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const jaw = findBone(scene, "Jaw");
  assert.ok(jaw, "Jaw bone must bind");

  const samples = 48;
  const jawPitchAngles = [];

  for (let i = 0; i <= samples; i++) {
    mixer.setTime((cruiseClip.duration * i) / samples);
    scene.updateMatrixWorld(true);
    const q = jaw.quaternion;
    const pitchDeg = Math.abs(2 * Math.atan2(q.x, q.w) * (180 / Math.PI));
    jawPitchAngles.push(pitchDeg);
  }

  mixer.setTime(0);
  scene.updateMatrixWorld(true);
  const q0 = jaw.quaternion.clone();

  mixer.setTime(cruiseClip.duration);
  scene.updateMatrixWorld(true);
  const qEnd = jaw.quaternion.clone();

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  const maxJawAngle = Math.max(...jawPitchAngles);
  const jawSeamDeg = (q0.angleTo(qEnd) * 180) / Math.PI;

  assert.ok(maxJawAngle < 20.0, `Jaw must remain closed and avoid 180-deg flip; got ${maxJawAngle}°`);
  assert.ok(jawSeamDeg < 0.2, `Jaw loop seam snapped by ${jawSeamDeg}°`);
  assert.ok(
    Math.abs(jaw.position.y - 9.80) < 0.2,
    `Jaw socket must remain seated at rest socket (~9.80); got y=${jaw.position.y.toFixed(2)} (vendor was 351.38)`
  );
});

test("wyvern v2 kinetics: head and neck execute dynamic aerodynamic gaze stabilization in cruise", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;
  const cruiseClip = gltf.animations.find((a) => a.name === "cruise");
  assert.ok(cruiseClip, "cruise clip must exist");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(cruiseClip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const head = findBone(scene, "Head");
  assert.ok(head, "Head bone must bind");

  const samples = 48;
  const headPitchAngles = [];

  for (let i = 0; i <= samples; i++) {
    mixer.setTime((cruiseClip.duration * i) / samples);
    scene.updateMatrixWorld(true);
    const q = head.quaternion;
    const pitchDeg = 2 * Math.atan2(q.x, q.w) * (180 / Math.PI);
    headPitchAngles.push(pitchDeg);
  }

  mixer.setTime(0);
  scene.updateMatrixWorld(true);
  const q0 = head.quaternion.clone();

  mixer.setTime(cruiseClip.duration);
  scene.updateMatrixWorld(true);
  const qEnd = head.quaternion.clone();

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  const pitchSpan = Math.max(...headPitchAngles) - Math.min(...headPitchAngles);
  const headSeamDeg = (q0.angleTo(qEnd) * 180) / Math.PI;

  assert.ok(pitchSpan > 1.5, `Head must actively counter-pitch for gaze stabilization; span ${pitchSpan}°`);
  assert.ok(headSeamDeg < 0.2, `Head loop seam snapped by ${headSeamDeg}°`);
});

test("wyvern v2 kinetics: all 10 caudal segments undulate with progressive traveling wave and sub-degree seam closure", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;
  const cruiseClip = gltf.animations.find((a) => a.name === "cruise");
  assert.ok(cruiseClip, "cruise clip must exist");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(cruiseClip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const tailBones = [];
  for (let i = 1; i <= 10; i++) {
    const bone = findBone(scene, `Tail${i}`);
    assert.ok(bone, `Tail${i} bone must bind`);
    tailBones.push(bone);
  }

  const samples = 48;
  const amplitudes = Array.from({ length: 10 }, () => []);

  for (let i = 0; i <= samples; i++) {
    mixer.setTime((cruiseClip.duration * i) / samples);
    scene.updateMatrixWorld(true);
    for (let t = 0; t < 10; t++) {
      const q = tailBones[t].quaternion;
      const pitchDeg = 2 * Math.atan2(q.x, q.w) * (180 / Math.PI);
      amplitudes[t].push(pitchDeg);
    }
  }

  mixer.setTime(0);
  scene.updateMatrixWorld(true);
  const q0Tails = tailBones.map((b) => b.quaternion.clone());

  mixer.setTime(cruiseClip.duration);
  scene.updateMatrixWorld(true);
  const qEndTails = tailBones.map((b) => b.quaternion.clone());

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  const spans = amplitudes.map((vals) => Math.max(...vals) - Math.min(...vals));

  for (let t = 0; t < 10; t++) {
    assert.ok(spans[t] > 1.0, `Tail${t + 1} must undulate actively; span was ${spans[t]}°`);
    const seamDeg = (q0Tails[t].angleTo(qEndTails[t]) * 180) / Math.PI;
    assert.ok(seamDeg < 0.2, `Tail${t + 1} seam snapped by ${seamDeg}°`);
  }

  assert.ok(
    spans[9] > spans[4] && spans[4] > spans[0],
    `Caudal wave must amplify down spine: root=${spans[0].toFixed(2)}°, mid=${spans[4].toFixed(2)}°, tip=${spans[9].toFixed(2)}°`
  );
});

test("wyvern v2 kinetics: jaw remains closed during bankLeft and bankRight without 180-degree inversion flips", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  for (const clipName of ["bankLeft", "bankRight"]) {
    const clip = gltf.animations.find((a) => a.name === clipName);
    assert.ok(clip, `${clipName} clip must exist`);

    const mixer = new AnimationMixer(scene);
    const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    const jaw = findBone(scene, "Jaw");
    assert.ok(jaw, "Jaw bone must bind");

    const samples = 48;
    const jawPitchAngles = [];

    for (let i = 0; i <= samples; i++) {
      mixer.setTime((clip.duration * i) / samples);
      scene.updateMatrixWorld(true);
      const q = jaw.quaternion;
      const pitchDeg = Math.abs(2 * Math.atan2(q.x, q.w) * (180 / Math.PI));
      jawPitchAngles.push(pitchDeg);
    }

    mixer.setTime(0);
    scene.updateMatrixWorld(true);
    const q0 = jaw.quaternion.clone();

    mixer.setTime(clip.duration);
    scene.updateMatrixWorld(true);
    const qEnd = jaw.quaternion.clone();

    mixer.stopAllAction();
    mixer.uncacheRoot(scene);

    const maxJawAngle = Math.max(...jawPitchAngles);
    const jawSeamDeg = (q0.angleTo(qEnd) * 180) / Math.PI;

    assert.ok(
      maxJawAngle < 20.0,
      `Jaw in ${clipName} must remain closed and avoid 180-deg flip; got ${maxJawAngle.toFixed(2)}°`
    );
    assert.ok(
      jawSeamDeg < 0.2,
      `Jaw in ${clipName} loop seam snapped by ${jawSeamDeg.toFixed(4)}°`
    );
    assert.ok(
      Math.abs(jaw.position.y - 9.80) < 0.2,
      `Jaw socket in ${clipName} must remain seated at rest socket (~9.80); got y=${jaw.position.y.toFixed(2)} (vendor was 351.38)`
    );
  }
});

test("wyvern v2 kinetics: head and neck execute dynamic gaze stabilization and bank turn lead during bankLeft and bankRight", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  for (const clipName of ["bankLeft", "bankRight"]) {
    const clip = gltf.animations.find((a) => a.name === clipName);
    assert.ok(clip, `${clipName} clip must exist`);

    const mixer = new AnimationMixer(scene);
    const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    const head = findBone(scene, "Head");
    const neck2 = findBone(scene, "Neck2");
    assert.ok(head && neck2, "Head and Neck2 bones must bind");

    const body = findBone(scene, "Body") || findBone(scene, "Spine1");
    assert.ok(body, "Body bone must bind");

    const samples = 48;
    const headPitchAngles = [];
    const relHeadPositions = [];

    for (let i = 0; i <= samples; i++) {
      mixer.setTime((clip.duration * i) / samples);
      scene.updateMatrixWorld(true);
      const q = head.quaternion;
      const pitchDeg = 2 * Math.atan2(q.x, q.w) * (180 / Math.PI);
      headPitchAngles.push(pitchDeg);

      const hp = new Vector3();
      const bp = new Vector3();
      head.getWorldPosition(hp);
      body.getWorldPosition(bp);
      relHeadPositions.push(hp.x - bp.x);
    }

    mixer.setTime(0);
    scene.updateMatrixWorld(true);
    const q0Head = head.quaternion.clone();

    mixer.setTime(clip.duration);
    scene.updateMatrixWorld(true);
    const qEndHead = head.quaternion.clone();

    mixer.stopAllAction();
    mixer.uncacheRoot(scene);

    const pitchSpan = Math.max(...headPitchAngles) - Math.min(...headPitchAngles);
    const headSeamDeg = (q0Head.angleTo(qEndHead) * 180) / Math.PI;

    assert.ok(
      pitchSpan > 1.5,
      `Head in ${clipName} must actively counter-pitch for gaze stabilization; span ${pitchSpan.toFixed(2)}°`
    );
    assert.ok(
      headSeamDeg < 0.2,
      `Head in ${clipName} loop seam snapped by ${headSeamDeg.toFixed(4)}°`
    );

    // Lateral turn lead check: bankLeft turns head to the inside (+X relative to body); bankRight mirrors (-X)
    const avgRelHeadX = relHeadPositions.reduce((s, x) => s + x, 0) / relHeadPositions.length;
    if (clipName === "bankLeft") {
      assert.ok(
        avgRelHeadX > 5.0,
        `bankLeft head must lean into the turn (+X), got relative X ${avgRelHeadX.toFixed(2)}`
      );
    } else {
      assert.ok(
        avgRelHeadX < -5.0,
        `bankRight head must lean into the turn (-X), got relative X ${avgRelHeadX.toFixed(2)}`
      );
    }
  }
});

test("wyvern v2 kinetics: bankLeft and bankRight execute progressive caudal waves with rudder counterbalance and sub-degree seams", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  for (const clipName of ["bankLeft", "bankRight"]) {
    const clip = gltf.animations.find((a) => a.name === clipName);
    assert.ok(clip, `${clipName} clip must exist`);

    const mixer = new AnimationMixer(scene);
    const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    const tailBones = [];
    const body = findBone(scene, "Body") || findBone(scene, "Spine1");
    assert.ok(body, "Body bone must bind");

    for (let i = 1; i <= 10; i++) {
      const bone = findBone(scene, `Tail${i}`);
      assert.ok(bone, `Tail${i} bone must bind`);
      tailBones.push(bone);
    }

    const samples = 48;
    const amplitudes = Array.from({ length: 10 }, () => []);
    const tailTipPositions = [];

    for (let i = 0; i <= samples; i++) {
      mixer.setTime((clip.duration * i) / samples);
      scene.updateMatrixWorld(true);
      for (let t = 0; t < 10; t++) {
        const q = tailBones[t].quaternion;
        const pitchDeg = 2 * Math.atan2(q.x, q.w) * (180 / Math.PI);
        amplitudes[t].push(pitchDeg);
      }
      const tp = new Vector3();
      const bp = new Vector3();
      tailBones[9].getWorldPosition(tp);
      body.getWorldPosition(bp);
      tailTipPositions.push(tp.x - bp.x);
    }

    mixer.setTime(0);
    scene.updateMatrixWorld(true);
    const q0Tails = tailBones.map((b) => b.quaternion.clone());

    mixer.setTime(clip.duration);
    scene.updateMatrixWorld(true);
    const qEndTails = tailBones.map((b) => b.quaternion.clone());

    mixer.stopAllAction();
    mixer.uncacheRoot(scene);

    const spans = amplitudes.map((vals) => Math.max(...vals) - Math.min(...vals));

    for (let t = 0; t < 10; t++) {
      assert.ok(
        spans[t] > 1.0,
        `Tail${t + 1} in ${clipName} must undulate actively; span was ${spans[t].toFixed(2)}°`
      );
      const seamDeg = (q0Tails[t].angleTo(qEndTails[t]) * 180) / Math.PI;
      assert.ok(
        seamDeg < 0.2,
        `Tail${t + 1} in ${clipName} seam snapped by ${seamDeg.toFixed(4)}°`
      );
    }

    assert.ok(
      spans[9] > spans[4] && spans[4] > spans[0],
      `Caudal wave in ${clipName} must amplify down spine: root=${spans[0].toFixed(2)}°, mid=${spans[4].toFixed(2)}°, tip=${spans[9].toFixed(2)}°`
    );

    // Rudder counterbalance check: bankLeft tail curves to turn exterior (-X); bankRight mirrors (+X)
    const avgTipX = tailTipPositions.reduce((s, x) => s + x, 0) / tailTipPositions.length;
    if (clipName === "bankLeft") {
      assert.ok(
        avgTipX < 0,
        `bankLeft tail must counterbalance to outside (-X), got mean X ${avgTipX.toFixed(2)}`
      );
    } else {
      assert.ok(
        avgTipX > 0,
        `bankRight tail must counterbalance to outside (+X), got mean X ${avgTipX.toFixed(2)}`
      );
    }
  }
});

test("wyvern v2 kinetics: jaw remains closed during glide and dive without 180-degree inversion flips", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  for (const clipName of ["glide", "dive"]) {
    const clip = gltf.animations.find((a) => a.name === clipName);
    assert.ok(clip, `${clipName} clip must exist`);

    const mixer = new AnimationMixer(scene);
    const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    const jaw = findBone(scene, "Jaw");
    assert.ok(jaw, "Jaw bone must bind");

    const samples = 48;
    const jawPitchAngles = [];

    for (let i = 0; i <= samples; i++) {
      mixer.setTime((clip.duration * i) / samples);
      scene.updateMatrixWorld(true);
      const q = jaw.quaternion;
      const pitchDeg = Math.abs(2 * Math.atan2(q.x, q.w) * (180 / Math.PI));
      jawPitchAngles.push(pitchDeg);
    }

    mixer.setTime(0);
    scene.updateMatrixWorld(true);
    const q0 = jaw.quaternion.clone();

    mixer.setTime(clip.duration);
    scene.updateMatrixWorld(true);
    const qEnd = jaw.quaternion.clone();

    mixer.stopAllAction();
    mixer.uncacheRoot(scene);

    const maxJawAngle = Math.max(...jawPitchAngles);
    const jawSeamDeg = (q0.angleTo(qEnd) * 180) / Math.PI;

    assert.ok(
      maxJawAngle < 20.0,
      `Jaw in ${clipName} must remain closed and avoid 180-deg flip; got ${maxJawAngle.toFixed(2)}°`
    );
    assert.ok(
      jawSeamDeg < 0.2,
      `Jaw in ${clipName} loop seam snapped by ${jawSeamDeg.toFixed(4)}°`
    );
    assert.ok(
      Math.abs(jaw.position.y - 9.80) < 0.2,
      `Jaw socket in ${clipName} must remain seated at rest socket (~9.80); got y=${jaw.position.y.toFixed(2)} (vendor was 351.38)`
    );
  }
});

test("wyvern v2 kinetics: glide maintains steady aerodynamic wing dihedral and horizon-scanning eyeline", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;
  const glideClip = gltf.animations.find((a) => a.name === "glide");
  assert.ok(glideClip, "glide clip must exist");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(glideClip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const shoulderL = findBone(scene, "L_WingShoulder") || findBone(scene, "WingShoulder.L");
  const head = findBone(scene, "Head");
  assert.ok(shoulderL && head, "Wing shoulder and head bones must bind");

  const samples = 48;
  const shoulderPitch = [];
  const headPitch = [];

  for (let i = 0; i <= samples; i++) {
    mixer.setTime((glideClip.duration * i) / samples);
    scene.updateMatrixWorld(true);

    const qs = shoulderL.quaternion;
    shoulderPitch.push(2 * Math.atan2(qs.x, qs.w) * (180 / Math.PI));

    const qh = head.quaternion;
    headPitch.push(2 * Math.atan2(qh.x, qh.w) * (180 / Math.PI));
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  const flapRange = Math.max(...shoulderPitch) - Math.min(...shoulderPitch);
  assert.ok(
    flapRange < 15.0,
    `Glide is a held-wing aerodynamic shape; shoulder flap range must be < 15°, got ${flapRange.toFixed(2)}°`
  );
});

test("wyvern v2 kinetics: dive exhibits streamlined nose-down pitch, wings swept and tucked flush against body, and locked target eyeline", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  // Compare wingspan between glide (open) and dive (tucked)
  let glideSpan = 0;
  {
    const glideClip = gltf.animations.find((a) => a.name === "glide");
    const mixer = new AnimationMixer(scene);
    mixer.clipAction(glideClip).play();
    mixer.setTime(0);
    scene.updateMatrixWorld(true);

    const tipL = findBone(scene, "L_WingD0P2") || findBone(scene, "L_WingHand");
    const tipR = findBone(scene, "R_WingD0P2") || findBone(scene, "R_WingHand");
    if (tipL && tipR) {
      const pL = new Vector3();
      const pR = new Vector3();
      tipL.getWorldPosition(pL);
      tipR.getWorldPosition(pR);
      glideSpan = pL.distanceTo(pR);
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(scene);
  }

  const diveClip = gltf.animations.find((a) => a.name === "dive");
  assert.ok(diveClip, "dive clip must exist");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(diveClip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const body = findBone(scene, "Body") || findBone(scene, "Spine1");
  const head = findBone(scene, "Head");
  const tipL = findBone(scene, "L_WingD0P2") || findBone(scene, "L_WingHand");
  const tipR = findBone(scene, "R_WingD0P2") || findBone(scene, "R_WingHand");
  assert.ok(body && head, "Body and Head bones must bind");

  const samples = 48;
  const bodyPitches = [];
  const headCounterPitches = [];
  const diveSpans = [];

  for (let i = 0; i <= samples; i++) {
    mixer.setTime((diveClip.duration * i) / samples);
    scene.updateMatrixWorld(true);

    const qb = body.quaternion;
    const bodyPitchDeg = 2 * Math.atan2(qb.x, qb.w) * (180 / Math.PI);
    bodyPitches.push(bodyPitchDeg);

    const qh = head.quaternion;
    const headPitchDeg = 2 * Math.atan2(qh.x, qh.w) * (180 / Math.PI);
    headCounterPitches.push(headPitchDeg);

    if (tipL && tipR) {
      const pL = new Vector3();
      const pR = new Vector3();
      tipL.getWorldPosition(pL);
      tipR.getWorldPosition(pR);
      diveSpans.push(pL.distanceTo(pR));
    }
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  const meanBodyPitch = bodyPitches.reduce((a, b) => a + b, 0) / bodyPitches.length;
  const meanHeadPitch = headCounterPitches.reduce((a, b) => a + b, 0) / headCounterPitches.length;
  const meanDiveSpan = diveSpans.length > 0 ? diveSpans.reduce((a, b) => a + b, 0) / diveSpans.length : 0;

  // Body rest pose in V2 rig has 93.77° pitch; dive stoop pitches +28° nose-down (meanBodyPitch ~ 121.8°)
  const stoopPlungeAngle = meanBodyPitch - 93.77;
  assert.ok(
    stoopPlungeAngle > 20.0,
    `Dive must exhibit streamlined nose-down plunge pitch (> +20° plunge from rest), got ${stoopPlungeAngle.toFixed(2)}°`
  );

  // Head and neck counter-pitch upward (negative local X) relative to plunging body axis to keep gaze locked on target
  assert.ok(
    meanHeadPitch < -5.0,
    `Dive must counter-pitch head upward (< -5° local X) to lock gaze forward/down on target, got ${meanHeadPitch.toFixed(2)}°`
  );

  if (glideSpan > 0 && meanDiveSpan > 0) {
    const tuckRatio = (glideSpan - meanDiveSpan) / glideSpan;
    assert.ok(
      tuckRatio > 0.25,
      `Dive wing span must be significantly tucked compared to glide (tuck ratio > 0.25); got ${tuckRatio.toFixed(3)}`
    );
  }
});

test("wyvern v2 kinetics: jaw remains closed during takeoff and land without 180-degree inversion flips", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  for (const clipName of ["takeoff", "land"]) {
    const clip = gltf.animations.find((a) => a.name === clipName);
    assert.ok(clip, `${clipName} clip must exist`);

    const mixer = new AnimationMixer(scene);
    const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    const jaw = findBone(scene, "Jaw");
    assert.ok(jaw, "Jaw bone must bind");

    const samples = 48;
    const jawPitchAngles = [];
    for (let i = 0; i <= samples; i++) {
      mixer.setTime((clip.duration * i) / samples);
      scene.updateMatrixWorld(true);

      const q = jaw.quaternion;
      const pitchDeg = Math.abs(2 * Math.atan2(q.x, q.w) * (180 / Math.PI));
      jawPitchAngles.push(pitchDeg);
    }

    mixer.stopAllAction();
    mixer.uncacheRoot(scene);

    const maxJawAngle = Math.max(...jawPitchAngles);
    assert.ok(
      maxJawAngle < 20.0,
      `Jaw in ${clipName} must remain closed and avoid 180-deg flip; got ${maxJawAngle.toFixed(2)}°`
    );
    assert.ok(
      Math.abs(jaw.position.y - 9.80) < 0.2,
      `Jaw socket in ${clipName} must remain seated at rest socket (~9.80); got y=${jaw.position.y.toFixed(2)} (vendor was 351.38)`
    );
  }
});

test("wyvern v2 kinetics: takeoff terminates in aerodynamic flight tuck matching cruise entry", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  const takeoffClip = gltf.animations.find((a) => a.name === "takeoff");
  const cruiseClip = gltf.animations.find((a) => a.name === "cruise");
  assert.ok(takeoffClip && cruiseClip, "takeoff and cruise clips must exist");

  const lFoot = findBone(scene, "L_Foot");
  const body = findBone(scene, "Body");
  assert.ok(lFoot && body, "L_Foot and Body bones must bind");

  const mixer = new AnimationMixer(scene);
  
  // Sample cruise leg tuck relative Y
  mixer.clipAction(cruiseClip).play();
  mixer.setTime(0);
  scene.updateMatrixWorld(true);
  const fpCruise = new Vector3();
  const bpCruise = new Vector3();
  lFoot.getWorldPosition(fpCruise);
  body.getWorldPosition(bpCruise);
  const cruiseRelY = fpCruise.y - bpCruise.y; // ~ -273.65

  mixer.stopAllAction();

  // Sample takeoff end relative Y
  const action = mixer.clipAction(takeoffClip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(takeoffClip.duration);
  scene.updateMatrixWorld(true);
  const fpTakeoffEnd = new Vector3();
  const bpTakeoffEnd = new Vector3();
  lFoot.getWorldPosition(fpTakeoffEnd);
  body.getWorldPosition(bpTakeoffEnd);
  const takeoffEndRelY = fpTakeoffEnd.y - bpTakeoffEnd.y;

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  // Takeoff must transition feet up into aerodynamic cruise tuck (within 30 units of cruise)
  const tuckDiscrepancy = Math.abs(takeoffEndRelY - cruiseRelY);
  assert.ok(
    tuckDiscrepancy < 30.0,
    `Takeoff end must blend into aerodynamic cruise leg tuck (delta < 30 units); got discrepancy ${tuckDiscrepancy.toFixed(2)} units (takeoffEnd=${takeoffEndRelY.toFixed(2)}, cruise=${cruiseRelY.toFixed(2)})`
  );
});

test("wyvern v2 kinetics: land begins from flight tuck and executes aerodynamic air-brake flare", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  const landClip = gltf.animations.find((a) => a.name === "land");
  const cruiseClip = gltf.animations.find((a) => a.name === "cruise");
  assert.ok(landClip && cruiseClip, "land and cruise clips must exist");

  const lFoot = findBone(scene, "L_Foot");
  const body = findBone(scene, "Body");
  assert.ok(lFoot && body, "L_Foot and Body bones must bind");

  const mixer = new AnimationMixer(scene);

  // 1. Initial posture matches cruise flight tuck (within 15 units)
  mixer.clipAction(cruiseClip).play();
  mixer.setTime(0);
  scene.updateMatrixWorld(true);
  const fpCruise = new Vector3();
  const bpCruise = new Vector3();
  lFoot.getWorldPosition(fpCruise);
  body.getWorldPosition(bpCruise);
  const cruiseRelY = fpCruise.y - bpCruise.y;

  mixer.stopAllAction();

  const action = mixer.clipAction(landClip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(0);
  scene.updateMatrixWorld(true);
  const fpLand0 = new Vector3();
  const bpLand0 = new Vector3();
  lFoot.getWorldPosition(fpLand0);
  body.getWorldPosition(bpLand0);
  const land0RelY = fpLand0.y - bpLand0.y;

  assert.ok(
    Math.abs(land0RelY - cruiseRelY) < 15.0,
    `Land start must match cruise leg tuck; got delta ${Math.abs(land0RelY - cruiseRelY).toFixed(2)}`
  );

  // 2. Air-brake flare: body pitch tilts nose-up (> 20° flare from neutral flight 93.8°) during deceleration phase
  let minBodyPitch = 180;
  for (let i = 0; i <= 24; i++) {
    mixer.setTime((landClip.duration * i) / 48); // first half of clip
    scene.updateMatrixWorld(true);
    const qb = body.quaternion;
    const bodyPitchDeg = 2 * Math.atan2(qb.x, qb.w) * (180 / Math.PI);
    if (bodyPitchDeg < minBodyPitch) minBodyPitch = bodyPitchDeg;
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  const flareDelta = 93.8 - minBodyPitch;
  assert.ok(
    flareDelta > 20.0,
    `Land must execute aerodynamic air-brake flare (> 20° nose-up pitch); got ${flareDelta.toFixed(2)}°`
  );
});

test("wyvern v2 kinetics: attack and attack2 execute ground melee jaw snap and clamp with skull recoil", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  for (const clipName of ["attack", "attack2"]) {
    const clip = gltf.animations.find((a) => a.name === clipName);
    assert.ok(clip, `${clipName} clip must exist`);

    const mixer = new AnimationMixer(scene);
    const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();

    const jaw = findBone(scene, "Jaw");
    const head = findBone(scene, "Head");
    const body = findBone(scene, "Body");
    const tail10 = findBone(scene, "Tail10");
    assert.ok(jaw && head && body, `Required bones must bind for ${clipName}`);

    const samples = 48;
    const jawPitches = [];
    const headPitches = [];
    const tail10X = [];
    const bodyWorldY = [];

    for (let i = 0; i <= samples; i++) {
      mixer.setTime((clip.duration * i) / samples);
      scene.updateMatrixWorld(true);

      const qj = jaw.quaternion;
      const jawPitch = 2 * Math.atan2(qj.x, qj.w) * (180 / Math.PI);
      jawPitches.push(jawPitch);

      const qh = head.quaternion;
      const headPitch = 2 * Math.atan2(qh.x, qh.w) * (180 / Math.PI);
      headPitches.push(headPitch);

      const bp = new Vector3();
      body.getWorldPosition(bp);
      bodyWorldY.push(bp.y);

      if (tail10) {
        const tp = new Vector3();
        tail10.getWorldPosition(tp);
        tail10X.push(tp.x);
      }
    }

    mixer.stopAllAction();
    mixer.uncacheRoot(scene);

    // 1. Jaw opens wide during anticipation/strike (pitch < -10°, > 23° open excursion from rest 13.56°)
    const minJawPitch = Math.min(...jawPitches);
    assert.ok(
      minJawPitch < -10.0,
      `${clipName} jaw must open wide during attack (pitch < -10°); got ${minJawPitch.toFixed(2)}°`
    );

    // 2. Jaw clamps tightly shut (returns to canonical closed resting angle ~13.56°)
    const endJawPitch = jawPitches[jawPitches.length - 1];
    assert.ok(
      Math.abs(endJawPitch - 13.56) < 1.0,
      `${clipName} jaw must clamp shut at rest (~13.56°); got ${endJawPitch.toFixed(2)}°`
    );

    // 3. Jaw socket remains seated at natural rest socket (y ~ 9.80, avoiding 351.38 penetration)
    assert.ok(
      Math.abs(jaw.position.y - 9.80) < 0.2,
      `${clipName} jaw socket must remain seated at rest socket (~9.80); got y=${jaw.position.y.toFixed(2)}`
    );

    // 4. Dynamic skull counter-pitch recoil
    const maxHeadPitch = Math.max(...headPitches);
    const minHeadPitch = Math.min(...headPitches);
    const skullRecoil = maxHeadPitch - minHeadPitch;
    assert.ok(
      skullRecoil > 10.0,
      `${clipName} skull must execute dynamic recoil (> 10° head pitch excursion); got ${skullRecoil.toFixed(2)}°`
    );

    // 5. Body world Y upright quadrupedal level (Y > 0, matching ~711 level, not -474 inverted vendor)
    const minBodyY = Math.min(...bodyWorldY);
    assert.ok(
      minBodyY > 0.0,
      `${clipName} body must maintain upright quadrupedal stance (> 0 Y); got ${minBodyY.toFixed(2)}`
    );

    // 6. For attack2: wide lateral tail sweep across all caudal segments
    if (clipName === "attack2" && tail10X.length > 0) {
      const tailSweepSpan = Math.max(...tail10X) - Math.min(...tail10X);
      assert.ok(
        tailSweepSpan > 250.0,
        `attack2 must execute wide lateral tail sweep (span > 250 units); got ${tailSweepSpan.toFixed(2)}`
      );
    }
  }
});

test("wyvern v2 kinetics: attackAir2 executes aerial talon strike and maintains flight wing lift", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  const clip = gltf.animations.find((a) => a.name === "attackAir2");
  assert.ok(clip, "attackAir2 clip must exist");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const body = findBone(scene, "Body");
  const lFoot = findBone(scene, "L_Foot");
  const tipL = findBone(scene, "L_WingD0P2") || findBone(scene, "L_WingHand");
  const tipR = findBone(scene, "R_WingD0P2") || findBone(scene, "R_WingHand");
  assert.ok(body && lFoot, "Body and L_Foot bones must bind");

  const samples = 48;
  const bodyWorldY = [];
  const footRelY = [];
  const spans = [];

  for (let i = 0; i <= samples; i++) {
    mixer.setTime((clip.duration * i) / samples);
    scene.updateMatrixWorld(true);

    const bp = new Vector3();
    body.getWorldPosition(bp);
    bodyWorldY.push(bp.y);

    const fp = new Vector3();
    lFoot.getWorldPosition(fp);
    footRelY.push(fp.y - bp.y);

    if (tipL && tipR) {
      const pL = new Vector3();
      const pR = new Vector3();
      tipL.getWorldPosition(pL);
      tipR.getWorldPosition(pR);
      spans.push(pL.distanceTo(pR));
    }
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  // 1. Flight coordinate orientation: body world Y remains positive (matching flight ~711 level, not -578 inverted vendor)
  const minBodyY = Math.min(...bodyWorldY);
  assert.ok(
    minBodyY > 0.0,
    `attackAir2 body must maintain upright flight coordinate space (> 0 Y); got ${minBodyY.toFixed(2)}`
  );

  // 2. Wings maintain flight span throughout (not collapsed to ground)
  if (spans.length > 0) {
    const meanSpan = spans.reduce((a, b) => a + b, 0) / spans.length;
    assert.ok(
      meanSpan > 1200.0,
      `attackAir2 must maintain aerodynamic flight wingspan (> 1200 units); got ${meanSpan.toFixed(2)}`
    );
  }

  // 3. Hind talons slash downward (reach stroke relative to body delta > 80 units)
  const maxFootReach = Math.max(...footRelY) - Math.min(...footRelY);
  assert.ok(
    maxFootReach > 80.0,
    `attackAir2 talons must execute downward strike rake stroke (> 80 units relative excursion); got ${maxFootReach.toFixed(2)}`
  );
});

test("wyvern v2 kinetics: breath executes wide jaw unhinge and respiratory expansion pumping", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  const clip = gltf.animations.find((a) => a.name === "breath");
  assert.ok(clip, "breath clip must exist");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const jaw = findBone(scene, "Jaw");
  const spine2 = findBone(scene, "Spine2") || findBone(scene, "Spine3");
  assert.ok(jaw && spine2, "Jaw and Spine bones must bind");

  const samples = 48;
  const jawPitches = [];
  const spinePitches = [];

  for (let i = 0; i <= samples; i++) {
    mixer.setTime((clip.duration * i) / samples);
    scene.updateMatrixWorld(true);

    const qj = jaw.quaternion;
    const jawPitch = 2 * Math.atan2(qj.x, qj.w) * (180 / Math.PI);
    jawPitches.push(jawPitch);

    const qs = spine2.quaternion;
    const spinePitch = 2 * Math.atan2(qs.x, qs.w) * (180 / Math.PI);
    spinePitches.push(spinePitch);
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  // 1. Jaw unhinges wide (> 45° open angle)
  const minJawPitch = Math.min(...jawPitches);
  assert.ok(
    minJawPitch < -45.0,
    `breath jaw must unhinge wide for channeled cone (pitch < -45°); got ${minJawPitch.toFixed(2)}°`
  );

  // 2. Chest respiratory pump (pitch excursion on Spine2 > 2.0°)
  const spineExcursion = Math.max(...spinePitches) - Math.min(...spinePitches);
  assert.ok(
    spineExcursion > 2.0,
    `breath must exhibit respiratory chest pump (> 2.0° spine pitch excursion); got ${spineExcursion.toFixed(2)}°`
  );

  // 3. Jaw clamps tightly shut at conclusion (~13.56° rest)
  const endJawPitch = jawPitches[jawPitches.length - 1];
  assert.ok(
    Math.abs(endJawPitch - 13.56) < 1.0,
    `breath jaw must clamp shut at end (~13.56°); got ${endJawPitch.toFixed(2)}°`
  );
});

test("wyvern v2 kinetics: death executes dramatic gravitational collapse and floor adherence", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  const clip = gltf.animations.find((a) => a.name === "death");
  assert.ok(clip, "death clip must exist");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const body = findBone(scene, "Body");
  const jaw = findBone(scene, "Jaw");
  const lFoot = findBone(scene, "L_Foot");
  assert.ok(body && jaw && lFoot, "Body, Jaw, and L_Foot bones must bind");

  const samples = 48;
  const bodyWorldY = [];
  const footWorldY = [];

  for (let i = 0; i <= samples; i++) {
    mixer.setTime((clip.duration * i) / samples);
    scene.updateMatrixWorld(true);

    const bp = new Vector3();
    body.getWorldPosition(bp);
    bodyWorldY.push(bp.y);

    const fp = new Vector3();
    lFoot.getWorldPosition(fp);
    footWorldY.push(fp.y);
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  // 1. Gravitational collapse: Body descends significantly toward floor (delta > 200 units, fixing vendor 0.40 freeze)
  const bodyCollapseDelta = bodyWorldY[0] - Math.min(...bodyWorldY);
  assert.ok(
    bodyCollapseDelta > 200.0,
    `death must execute dramatic gravitational collapse (> 200 units body Y drop); got ${bodyCollapseDelta.toFixed(2)} units`
  );

  // 2. Ground adherence: feet do not float in the air at end of clip (vendor was 646.65 units high in the sky!)
  const endFootY = footWorldY[footWorldY.length - 1];
  assert.ok(
    endFootY < 150.0,
    `death final feet pose must adhere to ground plane (< 150 units elevation); got ${endFootY.toFixed(2)} units (vendor was 646.65)`
  );
});

test("wyvern v2 kinetics: hover maintains vertical stationary flight elevation, predatory eyeline lock, and closed jaw", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  const clip = gltf.animations.find((a) => a.name === "hover");
  assert.ok(clip, "hover clip must exist");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const body = findBone(scene, "Body");
  const jaw = findBone(scene, "Jaw");
  const head = findBone(scene, "Head");
  const tipL = findBone(scene, "L_WingD0P2") || findBone(scene, "L_WingHand");
  const tipR = findBone(scene, "R_WingD0P2") || findBone(scene, "R_WingHand");
  assert.ok(body && jaw && head, "Body, Jaw, and Head bones must bind");

  const samples = 48;
  const bodyWorldY = [];
  const jawPitches = [];
  const headYaws = [];
  const spans = [];

  for (let i = 0; i <= samples; i++) {
    mixer.setTime((clip.duration * i) / samples);
    scene.updateMatrixWorld(true);

    const bp = new Vector3();
    body.getWorldPosition(bp);
    bodyWorldY.push(bp.y);

    const jq = jaw.quaternion;
    jawPitches.push(2 * Math.atan2(jq.x, jq.w) * (180 / Math.PI));

    const hq = head.quaternion;
    headYaws.push(2 * Math.atan2(hq.y, hq.w) * (180 / Math.PI));

    if (tipL && tipR) {
      const pL = new Vector3();
      const pR = new Vector3();
      tipL.getWorldPosition(pL);
      tipR.getWorldPosition(pR);
      spans.push(pL.distanceTo(pR));
    }
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  // 1. Jaw remains closed (< 20° pitch, near 13.56° rest, avoiding vendor 193.54° flip)
  const maxJawPitch = Math.max(...jawPitches);
  assert.ok(
    maxJawPitch < 20.0,
    `hover jaw must remain closed without 180-deg flip; got ${maxJawPitch.toFixed(2)}°`
  );

  // 2. Body maintains vertical flight elevation (> 680 units, eliminating vendor 383 unit drop)
  const minBodyY = Math.min(...bodyWorldY);
  assert.ok(
    minBodyY > 680.0,
    `hover must maintain vertical stationary flight elevation (> 680 units); got ${minBodyY.toFixed(2)} units`
  );

  // 3. Wings maintain active flight span throughout
  if (spans.length > 0) {
    const minSpan = Math.min(...spans);
    assert.ok(
      minSpan > 2200.0,
      `hover wings must maintain flight span (> 2200 units); got ${minSpan.toFixed(2)}`
    );
  }

  // 4. Eyeline station-keeping scan present
  const yawRange = Math.max(...headYaws) - Math.min(...headYaws);
  assert.ok(
    yawRange > 4.0,
    `hover head must execute station-keeping predatory eyeline scanning (> 4° yaw range); got ${yawRange.toFixed(2)}°`
  );
});

test("wyvern v2 kinetics: scout executes broad panoramic horizon scanning and steady soaring dihedral", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  const clip = gltf.animations.find((a) => a.name === "scout");
  assert.ok(clip, "scout clip must exist");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const body = findBone(scene, "Body");
  const jaw = findBone(scene, "Jaw");
  const head = findBone(scene, "Head");
  const tipL = findBone(scene, "L_WingD0P2") || findBone(scene, "L_WingHand");
  const tipR = findBone(scene, "R_WingD0P2") || findBone(scene, "R_WingHand");
  assert.ok(body && jaw && head, "Body, Jaw, and Head bones must bind");

  const samples = 48;
  const bodyWorldY = [];
  const jawPitches = [];
  const headYaws = [];
  const headPitches = [];
  const spans = [];

  for (let i = 0; i <= samples; i++) {
    mixer.setTime((clip.duration * i) / samples);
    scene.updateMatrixWorld(true);

    const bp = new Vector3();
    body.getWorldPosition(bp);
    bodyWorldY.push(bp.y);

    const jq = jaw.quaternion;
    jawPitches.push(2 * Math.atan2(jq.x, jq.w) * (180 / Math.PI));

    const hq = head.quaternion;
    headYaws.push(2 * Math.atan2(hq.y, hq.w) * (180 / Math.PI));
    headPitches.push(2 * Math.atan2(hq.x, hq.w) * (180 / Math.PI));

    if (tipL && tipR) {
      const pL = new Vector3();
      const pR = new Vector3();
      tipL.getWorldPosition(pL);
      tipR.getWorldPosition(pR);
      spans.push(pL.distanceTo(pR));
    }
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  // 1. Jaw remains closed (< 20° pitch)
  const maxJawPitch = Math.max(...jawPitches);
  assert.ok(
    maxJawPitch < 20.0,
    `scout jaw must remain closed without 180-deg flip; got ${maxJawPitch.toFixed(2)}°`
  );

  // 2. Broad panoramic horizon scanning (> 20° total yaw sweep, fixing vendor 0.00° freeze)
  const yawExcursion = Math.max(...headYaws) - Math.min(...headYaws);
  assert.ok(
    yawExcursion > 20.0,
    `scout must execute broad panoramic horizon scanning (> 20° head yaw sweep); got ${yawExcursion.toFixed(2)}°`
  );

  // 3. Steady soaring dihedral wingspan (> 5200 units throughout)
  if (spans.length > 0) {
    const minSpan = Math.min(...spans);
    assert.ok(
      minSpan > 5200.0,
      `scout wings must maintain steady soaring dihedral (> 5200 units); got ${minSpan.toFixed(2)}`
    );
  }

  // 4. Stable flight cruising elevation (> 680 units)
  const minBodyY = Math.min(...bodyWorldY);
  assert.ok(
    minBodyY > 680.0,
    `scout must maintain flight cruising elevation (> 680 units); got ${minBodyY.toFixed(2)} units`
  );
});

test("wyvern v2 kinetics: speed exhibits swept low-drag wing profile and forward thrust plunge pitch", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  const clip = gltf.animations.find((a) => a.name === "speed");
  assert.ok(clip, "speed clip must exist");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const body = findBone(scene, "Body");
  const jaw = findBone(scene, "Jaw");
  const lFoot = findBone(scene, "L_Foot");
  const tipL = findBone(scene, "L_WingD0P2") || findBone(scene, "L_WingHand");
  const tipR = findBone(scene, "R_WingD0P2") || findBone(scene, "R_WingHand");
  assert.ok(body && jaw && lFoot, "Body, Jaw, and L_Foot bones must bind");

  const samples = 48;
  const bodyPitches = [];
  const jawPitches = [];
  const footWorldY = [];
  const spans = [];

  for (let i = 0; i <= samples; i++) {
    mixer.setTime((clip.duration * i) / samples);
    scene.updateMatrixWorld(true);

    const bq = body.quaternion;
    bodyPitches.push(2 * Math.atan2(bq.x, bq.w) * (180 / Math.PI));

    const jq = jaw.quaternion;
    jawPitches.push(2 * Math.atan2(jq.x, jq.w) * (180 / Math.PI));

    const fp = new Vector3();
    lFoot.getWorldPosition(fp);
    footWorldY.push(fp.y);

    if (tipL && tipR) {
      const pL = new Vector3();
      const pR = new Vector3();
      tipL.getWorldPosition(pL);
      tipR.getWorldPosition(pR);
      spans.push(pL.distanceTo(pR));
    }
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  // 1. Jaw clamped tightly shut
  const maxJawPitch = Math.max(...jawPitches);
  assert.ok(
    maxJawPitch < 20.0,
    `speed jaw must remain closed without 180-deg flip; got ${maxJawPitch.toFixed(2)}°`
  );

  // 2. Forward thrust plunge pitch on Body (> 105° in glTF coordinate space vs neutral 93.8°)
  const maxBodyPitch = Math.max(...bodyPitches);
  assert.ok(
    maxBodyPitch > 105.0,
    `speed must exhibit forward thrust penetration pitch (> 105° Body pitch); got ${maxBodyPitch.toFixed(2)}°`
  );

  // 3. Swept low-drag wing profile: mean span compressed (< 3000 units vs vendor 5423 units)
  if (spans.length > 0) {
    const meanSpan = spans.reduce((a, b) => a + b, 0) / spans.length;
    assert.ok(
      meanSpan < 3000.0,
      `speed wings must maintain swept low-drag tuck (mean span < 3000 units); got ${meanSpan.toFixed(2)} units (vendor was 5423)`
    );
  }

  // 4. Streamlined leg slipstream tuck (< 750 units, eliminating vendor 827 flail)
  const maxFootY = Math.max(...footWorldY);
  assert.ok(
    maxFootY < 750.0,
    `speed legs must tuck cleanly in slipstream (< 750 units); got ${maxFootY.toFixed(2)} units`
  );
});

test("wyvern v2 kinetics: rest settles into low quadrupedal ground posture with flank-folded wings", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  const clip = gltf.animations.find((a) => a.name === "rest");
  assert.ok(clip, "rest clip must exist");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const body = findBone(scene, "Body");
  const jaw = findBone(scene, "Jaw");
  const lFoot = findBone(scene, "L_Foot");
  const handL = findBone(scene, "L_WingHand");
  const handR = findBone(scene, "R_WingHand");
  assert.ok(body && jaw && lFoot && handL && handR, "Body, Jaw, Foot, and WingHand bones must bind");

  const digitBoneNames = ["L_WingD0P2", "L_WingD1P2", "L_WingD2P2", "L_WingD3P2", "L_WingD4P2"];
  const digitBones = digitBoneNames.map((name) => findBone(scene, name)).filter(Boolean);

  const samples = 48;
  const bodyWorldY = [];
  const jawPitches = [];
  const footWorldY = [];
  const handSpans = [];
  const maxDigitHeights = [];

  for (let i = 0; i <= samples; i++) {
    mixer.setTime((clip.duration * i) / samples);
    scene.updateMatrixWorld(true);

    const bp = new Vector3();
    body.getWorldPosition(bp);
    bodyWorldY.push(bp.y);

    const jq = jaw.quaternion;
    jawPitches.push(2 * Math.atan2(jq.x, jq.w) * (180 / Math.PI));

    const fp = new Vector3();
    lFoot.getWorldPosition(fp);
    footWorldY.push(fp.y);

    const pL = new Vector3();
    const pR = new Vector3();
    handL.getWorldPosition(pL);
    handR.getWorldPosition(pR);
    handSpans.push(pL.distanceTo(pR));

    for (const db of digitBones) {
      const p = new Vector3();
      db.getWorldPosition(p);
      maxDigitHeights.push(p.y);
    }
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  // 1. Low quadrupedal ground settle: Body elevation settles onto ground (< 500 units vs vendor 711.65 flight height)
  const maxBodyY = Math.max(...bodyWorldY);
  assert.ok(
    maxBodyY < 500.0,
    `rest body must settle into low quadrupedal ground posture (< 500 units elevation); got ${maxBodyY.toFixed(2)} units (vendor was 711.65)`
  );

  // 2. Compact flank-folded knuckle wingspan (< 1800 units throughout, fixing vendor 5423 unit flare)
  const maxHandSpan = Math.max(...handSpans);
  assert.ok(
    maxHandSpan < 1800.0,
    `rest wings must fold compactly along flanks (< 1800 units hand span); got ${maxHandSpan.toFixed(2)} units (vendor was 5423)`
  );

  // 3. Ground plane paw contact (< 250 units elevation)
  const maxFootY = Math.max(...footWorldY);
  assert.ok(
    maxFootY < 250.0,
    `rest paws must adhere to ground plane (< 250 units elevation); got ${maxFootY.toFixed(2)} units`
  );

  // 4. Closed resting jaw (< 20° pitch)
  const maxJawPitch = Math.max(...jawPitches);
  assert.ok(
    maxJawPitch < 20.0,
    `rest jaw must remain closed; got ${maxJawPitch.toFixed(2)}°`
  );

  // 5. Wing digit tips stream along flanks below spine height (< 500 units vs broken 881.9)
  const maxDigitY = Math.max(...maxDigitHeights);
  assert.ok(
    maxDigitY < 500.0,
    `rest wing digit tips must stay folded below spine (< 500 units); got max y=${maxDigitY.toFixed(1)} (broken was 881.9)`
  );
});

test("wyvern v2 kinetics: idle clip exhibits quadrupedal ground posture with wings folded backward along flanks", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  const clip = gltf.animations.find((a) => a.name === "idle");
  assert.ok(clip, "idle clip must exist");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const body = findBone(scene, "Body");
  const spine3 = findBone(scene, "Spine3");
  const head = findBone(scene, "Head");
  const jaw = findBone(scene, "Jaw");
  const footL = findBone(scene, "L_Foot");
  const footR = findBone(scene, "R_Foot");
  const tail1 = findBone(scene, "Tail1");
  const tail10 = findBone(scene, "Tail10");
  const handL = findBone(scene, "L_WingHand");
  const handR = findBone(scene, "R_WingHand");
  assert.ok(
    body && spine3 && head && jaw && footL && footR && tail1 && tail10 && handL && handR,
    "Body, Spine, Head, Jaw, Feet, Tail, and WingHand bones must bind"
  );

  const digitBoneNames = [
    "L_WingD0P2", "L_WingD1P2", "L_WingD2P2", "L_WingD3P2", "L_WingD4P2",
    "R_WingD0P2", "R_WingD1P2", "R_WingD2P2", "R_WingD3P2", "R_WingD4P2",
  ];
  const digitBones = digitBoneNames.map((name) => {
    const bone = findBone(scene, name);
    assert.ok(bone, `Digit bone ${name} must bind`);
    return bone;
  });

  const samples = 48;
  const maxDigitHeights = [];
  const handSpans = [];
  const jawPitches = [];
  const footLHeights = [];
  const footRHeights = [];
  const spine3Pitches = [];
  const headPitches = [];
  const tail1Pitches = [];
  const tail10Pitches = [];

  for (let i = 0; i <= samples; i++) {
    mixer.setTime((clip.duration * i) / samples);
    scene.updateMatrixWorld(true);

    const jq = jaw.quaternion;
    jawPitches.push(2 * Math.atan2(jq.x, jq.w) * (180 / Math.PI));

    const s3q = spine3.quaternion;
    spine3Pitches.push(2 * Math.atan2(s3q.x, s3q.w) * (180 / Math.PI));

    const hq = head.quaternion;
    headPitches.push(2 * Math.atan2(hq.x, hq.w) * (180 / Math.PI));

    const t1q = tail1.quaternion;
    tail1Pitches.push(2 * Math.atan2(t1q.x, t1q.w) * (180 / Math.PI));

    const t10q = tail10.quaternion;
    tail10Pitches.push(2 * Math.atan2(t10q.x, t10q.w) * (180 / Math.PI));

    const pFL = new Vector3();
    const pFR = new Vector3();
    footL.getWorldPosition(pFL);
    footR.getWorldPosition(pFR);
    footLHeights.push(pFL.y);
    footRHeights.push(pFR.y);

    const pL = new Vector3();
    const pR = new Vector3();
    handL.getWorldPosition(pL);
    handR.getWorldPosition(pR);
    handSpans.push(pL.distanceTo(pR));

    for (const db of digitBones) {
      const p = new Vector3();
      db.getWorldPosition(p);
      maxDigitHeights.push(p.y);
    }
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  // 1. Folded wingspan along flanks (< 1800 units hand span)
  const maxHandSpan = Math.max(...handSpans);
  assert.ok(
    maxHandSpan < 1800.0,
    `idle wings must fold compactly along flanks (< 1800 units hand span); got ${maxHandSpan.toFixed(2)} units`
  );

  // 2. Wing digit tips remain nestled below spine height (< 450 units vs broken 869.7 vertical sail)
  const maxDigitY = Math.max(...maxDigitHeights);
  assert.ok(
    maxDigitY < 450.0,
    `idle wing digit tips must not stick into sky like sails (< 450 units); got ${maxDigitY.toFixed(1)} units (broken was 869.7)`
  );

  // 3. Closed idle jaw (< 15° pitch)
  const maxJawPitch = Math.max(...jawPitches);
  assert.ok(
    maxJawPitch < 15.0,
    `idle jaw must remain closed; got ${maxJawPitch.toFixed(2)}°`
  );

  // 4. Ground contact stability: zero foot slip or height drift (< 2.0 units travel)
  const footLTravel = Math.max(...footLHeights) - Math.min(...footLHeights);
  const footRTravel = Math.max(...footRHeights) - Math.min(...footRHeights);
  assert.ok(
    footLTravel < 2.0 && footRTravel < 2.0,
    `idle feet must stay firmly planted on ground (< 2.0 units travel); got L=${footLTravel.toFixed(2)}, R=${footRTravel.toFixed(2)}`
  );

  // 5. Chest respiration heave (> 2.0° range on Spine3)
  const spine3Range = Math.max(...spine3Pitches) - Math.min(...spine3Pitches);
  assert.ok(
    spine3Range > 2.0,
    `idle chest must heave organically with breath (> 2.0° pitch range); got ${spine3Range.toFixed(2)}°`
  );

  // 6. Head gaze stabilization (> 3.0° counter-pitch range)
  const headPitchRange = Math.max(...headPitches) - Math.min(...headPitches);
  assert.ok(
    headPitchRange > 3.0,
    `idle head must execute active gaze stabilization (> 3.0° pitch range); got ${headPitchRange.toFixed(2)}°`
  );

  // 7. Progressive caudal counterbalance wave (Tail10 amplitude > Tail1 amplitude)
  const tail1Range = Math.max(...tail1Pitches) - Math.min(...tail1Pitches);
  const tail10Range = Math.max(...tail10Pitches) - Math.min(...tail10Pitches);
  assert.ok(
    tail1Range > 0.3 && tail10Range > tail1Range,
    `idle tail must propagate harmonic wave progressively (tail10 > tail1); got tail1=${tail1Range.toFixed(2)}°, tail10=${tail10Range.toFixed(2)}°`
  );
});

test("wyvern v2 kinetics: wing membrane is properly skinned and spans to the wing digit tips in cruise without mesh detachment", async () => {
  const { scene, animations } = await loadWyvernV2Scene();
  const clip = animations.find((a) => a.name === "cruise");
  assert.ok(clip, "Base model must contain cruise animation");

  let membraneMesh = null;
  scene.traverse((obj) => {
    if (obj.isSkinnedMesh && obj.name.includes("Membrane")) {
      membraneMesh = obj;
    }
  });
  assert.ok(membraneMesh, "Wyvern model must include WyvernMembrane_ExportSafe skinned mesh");

  const lWingTip = findBone(scene, "L_WingD0P2");
  assert.ok(lWingTip, "Rig must include L_WingD0P2 bone");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(clip);
  action.play();

  // Evaluate at mid-wingbeat t=1.0s
  mixer.setTime(1.0);
  scene.updateMatrixWorld(true);
  membraneMesh.skeleton.update();

  const geom = membraneMesh.geometry;
  const pos = geom.attributes.position;
  const skinIndices = geom.attributes.skinIndex;
  const skinWeights = geom.attributes.skinWeight;
  const boneMatrices = membraneMesh.skeleton.boneMatrices;

  let maxMembraneX = -Infinity;
  const v = new Vector3();
  const skinVertex = new Vector3();
  const temp = new Vector3();
  const bMat = new Matrix4();

  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    skinVertex.set(0, 0, 0);

    for (let k = 0; k < 4; k++) {
      const weight = skinWeights.getComponent(i, k);
      if (weight > 0) {
        const boneIndex = skinIndices.getComponent(i, k);
        bMat.fromArray(boneMatrices, boneIndex * 16);
        temp.copy(v).applyMatrix4(bMat).multiplyScalar(weight);
        skinVertex.add(temp);
      }
    }
    skinVertex.applyMatrix4(membraneMesh.matrixWorld);
    if (skinVertex.x > maxMembraneX) maxMembraneX = skinVertex.x;
  }

  const wingTipPos = new Vector3();
  lWingTip.getWorldPosition(wingTipPos);

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  // In the broken model, maxMembraneX was only 1453 units while wingtip was at 2380 units.
  // In the correctly skinned model, maxMembraneX reaches > 2700 units (measured 2780.9 units),
  // properly enclosing and extending to the wing digit tips.
  assert.ok(
    maxMembraneX > 2500.0,
    `Wing membrane must span out with the wing digit bones (> 2500 units); got ${maxMembraneX.toFixed(1)} units (broken was 1453 units)`
  );
  assert.ok(
    maxMembraneX >= wingTipPos.x,
    `Wing membrane extent (${maxMembraneX.toFixed(1)}) must reach or exceed wingtip bone position (${wingTipPos.x.toFixed(1)})`
  );
});

test("wyvern v2 kinetics: takeoff initiates in quadrupedal ground fold, unfurls with explosive push-off, and maintains dual wingbeat flight cycle", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;

  const clip = gltf.animations.find((a) => a.name === "takeoff");
  assert.ok(clip, "takeoff clip must exist on V2 rig");

  const handL = findBone(scene, "L_WingHand");
  const handR = findBone(scene, "R_WingHand");
  const d3L = findBone(scene, "L_WingD3P2");
  const jaw = findBone(scene, "Jaw");
  const footL = findBone(scene, "L_Foot");
  const body = findBone(scene, "Body");
  assert.ok(handL && handR && d3L && jaw && footL && body, "All required bones must bind");

  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();

  const samples = 72; // Sample every frame (24 fps * 3.0s = 72 frames)
  const handSpans = [];
  const handLHeights = [];
  const legExtensions = [];
  const jawPitches = [];

  for (let i = 0; i <= samples; i++) {
    mixer.setTime((clip.duration * i) / samples);
    scene.updateMatrixWorld(true);

    const pHL = new Vector3();
    const pHR = new Vector3();
    const pFoot = new Vector3();
    const pBody = new Vector3();
    handL.getWorldPosition(pHL);
    handR.getWorldPosition(pHR);
    footL.getWorldPosition(pFoot);
    body.getWorldPosition(pBody);

    handSpans.push(pHL.distanceTo(pHR));
    handLHeights.push(pHL.y);
    legExtensions.push(pBody.y - pFoot.y);

    const jq = jaw.quaternion;
    jawPitches.push(2 * Math.atan2(jq.x, jq.w) * (180 / Math.PI));
  }

  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  // 1. Initial posture at f=0: quadrupedal ground fold
  // Hand span is compact (< 1750 units) and knuckles grounded
  assert.ok(
    handSpans[0] < 1750.0,
    `Takeoff f=0 must start in compact ground wing fold (< 1750 units hand span); got ${handSpans[0].toFixed(1)} units`
  );
  assert.ok(
    jawPitches[0] < 15.0,
    `Takeoff f=0 jaw must remain closed in resting orientation (< 15°); got ${jawPitches[0].toFixed(1)}°`
  );

  // 2. Phase 1 unfurl: hand span expands from compact fold to wide apex (> 2200 units)
  const maxHandSpan = Math.max(...handSpans);
  assert.ok(
    maxHandSpan > 2200.0,
    `Takeoff wings must unfurl into high-dihedral apex (> 2200 units hand span); got ${maxHandSpan.toFixed(1)} units`
  );

  // 3. Phase 2 explosive push-off: hind leg extension stroke (> 150 units drive)
  const minLegExt = Math.min(...legExtensions.slice(0, 24)); // crouch phase
  const maxLegExt = Math.max(...legExtensions.slice(20, 48)); // push-off extension
  const pushOffDrive = maxLegExt - minLegExt;
  assert.ok(
    pushOffDrive > 150.0,
    `Takeoff hind limbs must execute explosive downward push-off drive (> 150 units extension delta); got ${pushOffDrive.toFixed(1)} units`
  );

  // 4. Dual wingbeat continuity in flight phase:
  // Wing hand elevation must execute at least 2 distinct peaks and valleys (no frozen hover)
  const peak1 = Math.max(...handLHeights.slice(10, 26)); // apex 1 (~frame 18)
  const valley1 = Math.min(...handLHeights.slice(26, 42)); // downstroke 1 (~frame 36)
  const peak2 = Math.max(...handLHeights.slice(42, 58)); // apex 2 (~frame 48)
  const valley2 = handLHeights[handLHeights.length - 1]; // cruise entry (~frame 72)

  assert.ok(
    peak1 - valley1 > 500.0,
    `First wingbeat stroke amplitude must be high-energy (> 500 units); got ${(peak1 - valley1).toFixed(1)} units`
  );
  assert.ok(
    peak2 - valley1 > 300.0,
    `Second wingbeat upstroke must clearly elevate (> 300 units above downstroke valley); got ${(peak2 - valley1).toFixed(1)} units`
  );
  assert.ok(
    peak2 - valley2 > 200.0,
    `Second downstroke must actively sweep down toward cruise entry (> 200 units delta); got ${(peak2 - valley2).toFixed(1)} units`
  );
});

test("wyvern v2 kinetics: runtime flight rig articulates feet, toes, and legs across land walk, takeoff launch, and flight suspension", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;
  const lToes = findBone(scene, "L_Toes");
  const rToes = findBone(scene, "R_Toes");
  const lThigh = findBone(scene, "L_Thigh");
  assert.ok(lToes && rToes && lThigh, "Required bones must bind on V2 model");

  const baseToeQ = lToes.quaternion.clone();
  const baseThighQ = lThigh.quaternion.clone();
  const rig = createWyvernFlightRig(scene);

  // 1. Walk Gait Articulation: Toes must articulate across swing and stance
  rig.update(
    {
      horizontalSpeed: 3.5,
      verticalSpeed: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 0,
      clipName: "walk",
      clipTime: 0.6, // Left swing
    },
    null,
    1 / 60,
  );
  const swingAngleDeg = (lToes.quaternion.angleTo(baseToeQ) * 180) / Math.PI;
  assert.ok(swingAngleDeg > 2.0, `Left toes must articulate in walk swing, got ${swingAngleDeg.toFixed(2)}°`);

  rig.update(
    {
      horizontalSpeed: 3.5,
      verticalSpeed: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 0,
      clipName: "walk",
      clipTime: 1.8, // Left stance
    },
    null,
    1 / 60,
  );
  const stanceAngleDeg = (lToes.quaternion.angleTo(baseToeQ) * 180) / Math.PI;
  assert.ok(stanceAngleDeg > 2.0, `Left toes must articulate in walk stance, got ${stanceAngleDeg.toFixed(2)}°`);

  // 2. Takeoff Crouch & Push-off Drive
  rig.update(
    {
      horizontalSpeed: 0,
      verticalSpeed: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 0,
      clipName: "takeoff",
      flightMode: "takeoff",
      clipTime: 0.5, // Crouch load
    },
    null,
    1 / 60,
  );
  const crouchGripAngleDeg = (lToes.quaternion.angleTo(baseToeQ) * 180) / Math.PI;
  assert.ok(crouchGripAngleDeg > 2.0, `Toes must grip floor during takeoff crouch, got ${crouchGripAngleDeg.toFixed(2)}°`);

  rig.update(
    {
      horizontalSpeed: 10,
      verticalSpeed: 6,
      pitch: -0.2,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 1.2,
      clipName: "takeoff",
      flightMode: "takeoff",
      clipTime: 1.1, // Push-off drive
    },
    null,
    1 / 60,
  );
  const pushoffAngleDeg = (lToes.quaternion.angleTo(baseToeQ) * 180) / Math.PI;
  assert.ok(
    pushoffAngleDeg > 5.0,
    `Toes must execute downward push-off drive in launch stroke, got ${pushoffAngleDeg.toFixed(2)}°`,
  );

  // 3. Flight Downstroke Suspension
  rig.update(
    {
      horizontalSpeed: 18,
      verticalSpeed: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 20,
      wingStrokePhase: 0,
    },
    null,
    1 / 60,
  );
  const glideThighQ = lThigh.quaternion.clone();

  rig.update(
    {
      horizontalSpeed: 18,
      verticalSpeed: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 20,
      wingStrokePhase: 1.0, // Downstroke power phase
    },
    null,
    1 / 60,
  );
  const downstrokeSuspensionDeg = (lThigh.quaternion.angleTo(glideThighQ) * 180) / Math.PI;
  assert.ok(
    downstrokeSuspensionDeg > 1.0,
    `Leg must experience downward compliance on downstroke, got ${downstrokeSuspensionDeg.toFixed(2)}° vs glide`,
  );

  // 4. Ground Idle Claw Grip
  rig.update(
    {
      horizontalSpeed: 0,
      verticalSpeed: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 0,
      clipName: "idle",
      flightMode: "ground",
      clipTime: 1.0,
    },
    null,
    1 / 60,
  );
  const idleGripAngleDeg = (lToes.quaternion.angleTo(baseToeQ) * 180) / Math.PI;
  assert.ok(idleGripAngleDeg > 1.5, `Toes must grip floor in ground idle, got ${idleGripAngleDeg.toFixed(2)}°`);
});


test("wyvern v2 rig: all 18 animations keep wing membrane panels coordinated within 1.0 deg of adjacent digits", async () => {
  const gltf = await loadWyvernV2Scene();
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);

  const bones = {};
  const bindWorldInv = {};
  scene.traverse((obj) => {
    if (obj.isBone) {
      bones[obj.name] = obj;
      bindWorldInv[obj.name] = obj.matrixWorld.clone().invert();
    }
  });

  const panelRules = [
    ["WingPanel0_0", "WingD0P1", "WingD1P1"],
    ["WingPanel0_1", "WingD0P2", "WingD1P2"],
    ["WingPanel1_0", "WingD1P1", "WingD2P1"],
    ["WingPanel1_1", "WingD1P2", "WingD2P2"],
    ["WingPanel2_0", "WingD2P1", "WingD3P1"],
    ["WingPanel2_1", "WingD2P2", "WingD3P2"],
    ["WingPanel3_0", "WingD3P1", "WingD4P1"],
    ["WingPanel3_1", "WingD3P2", "WingD4P2"],
  ];

  // Provenance: tools/blender/coordinate_all_v2_clips.mjs measured 18.88 deg - 179.97 deg
  // pre-repair panel skin-delta desynchronization and 0.10 deg - 0.71 deg post-repair across all 18 clips.
  const MAX_PANEL_ERROR_DEG = 1.0;
  const mixer = new AnimationMixer(scene);
  const deltaMat = new Matrix4();
  const q0 = new Quaternion();
  const q1 = new Quaternion();
  const qPanel = new Quaternion();

  assert.equal(gltf.animations.length, 18, "Rig must carry all 18 canonical clips");

  for (const clip of gltf.animations) {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.reset().play();

    let clipWorstErrDeg = 0;
    const sampleCount = 8;
    for (let s = 0; s <= sampleCount; s++) {
      const t = (clip.duration * s) / sampleCount;
      mixer.setTime(t);
      scene.updateMatrixWorld(true);

      for (const side of ["L", "R"]) {
        for (const [panelBase, leftBase, rightBase] of panelRules) {
          const pName = `${side}_${panelBase}`;
          const aName = `${side}_${leftBase}`;
          const bName = `${side}_${rightBase}`;
          const pBone = bones[pName];
          const aBone = bones[aName];
          const bBone = bones[bName];
          assert.ok(pBone && aBone && bBone, `Missing panel/digit bone in ${clip.name}: ${pName}`);

          deltaMat.multiplyMatrices(aBone.matrixWorld, bindWorldInv[aName]);
          q0.setFromRotationMatrix(deltaMat);
          deltaMat.multiplyMatrices(bBone.matrixWorld, bindWorldInv[bName]);
          q1.setFromRotationMatrix(deltaMat);
          if (q0.dot(q1) < 0) q1.set(-q1.x, -q1.y, -q1.z, -q1.w);
          q0.slerp(q1, 0.5).normalize();

          deltaMat.multiplyMatrices(pBone.matrixWorld, bindWorldInv[pName]);
          qPanel.setFromRotationMatrix(deltaMat);

          const dot = Math.min(1, Math.abs(qPanel.dot(q0)));
          const errDeg = (2 * Math.acos(dot) * 180) / Math.PI;
          if (errDeg > clipWorstErrDeg) clipWorstErrDeg = errDeg;
        }
      }
    }

    assert.ok(
      clipWorstErrDeg < MAX_PANEL_ERROR_DEG,
      `Clip ${clip.name} panel neighbor error ${clipWorstErrDeg.toFixed(2)}° exceeds ${MAX_PANEL_ERROR_DEG}°`,
    );
  }
});
