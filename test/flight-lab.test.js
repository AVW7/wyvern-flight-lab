import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as THREE from "three";
import { FLIGHT_LAB_SPECIMENS, findFlightLabSpecimen, PINNED_RUNTIME_MODEL, V2_RIG_CLIPS, V1_RIG_CLIPS, V2_RIG_JOINT_COUNT } from "../src/flight-lab/catalog.ts";
import {
  CLIP_ALIASES,
  MODE_CLIPS,
  resolveAllModeCapabilities,
  resolveClipAlias,
  resolveFlightLabClip,
} from "../src/flight-lab/clipResolver.ts";
import { countSkinJoints, validateLoadedContract } from "../src/flight-lab/contractGuard.ts";
import { computeMeshMetrics } from "../src/flight-lab/diagnostics.ts";
import { scanSeam } from "../src/flight-lab/motionProbe.ts";
import {
  detectPoseAnomalies,
  detectTransitionAnomalies,
  scanClipAnomalies,
} from "../src/flight-lab/poseEnvelope.ts";
import { createPoseAnomalyOverlay, POSE_ANOMALY_RING_COLOR } from "../src/flight-lab/poseAnomalyOverlay.ts";
import { createPingVisualManager } from "../src/flight-lab/inspectionPins.ts";
import { flushMixerBindings, mixerBindingsAreSupported } from "../src/flight-lab/rig/mixerBindings.ts";
import { QUICK_LOCOMOTION_ACTIONS } from "../src/flight-lab/controlHelpers.ts";
import {
  CAPTURE_PATH,
  ISSUE_PATH,
  TELEMETRY_PATH,
  isPngSignature,
  parseReportRequest,
} from "../src/flight-lab/evidenceInbox.ts";
import { buildEvidenceMarkdown } from "../src/flight-lab/evidenceExport.ts";
import {
  calculateClipTelemetry,
  calculateEffectiveRate,
  calculateFrameStepTime,
  canSpecimenExecuteMode,
  canSpecimenExecuteOneShot,
  canSpecimenScrub,
  FLIGHT_LAB_SHORTCUTS,
  FRAME_STEP_INTERVAL,
  isDeathAction,
  isEditableElement,
} from "../src/flight-lab/playback.ts";

test("flight lab keeps the v2 rig as its primary specimen", () => {
  assert.equal(FLIGHT_LAB_SPECIMENS[0].id, "wyvern-v2-rig");
  assert.equal(FLIGHT_LAB_SPECIMENS[0].modelFile, "wyvern-v2-rig.glb");
  assert.equal(findFlightLabSpecimen("missing").id, "wyvern-v2-rig");
});

test("every flight specimen resolves to a project GLB", async () => {
  assert.equal(new Set(FLIGHT_LAB_SPECIMENS.map(s => s.id)).size, FLIGHT_LAB_SPECIMENS.length);
  await Promise.all(FLIGHT_LAB_SPECIMENS.map((specimen) => access(new URL(`../public/models/${specimen.modelFile}`, import.meta.url))));
});

test("v2 rig exposes the complete flight and reaction vocabulary", () => {
  for (const clip of ["takeoff", "cruise", "bankLeft", "bankRight", "attack", "death"]) {
    assert.ok(V2_RIG_CLIPS.includes(clip));
  }
});

test("v1 rig exposes baseline flight and ground clips", () => {
  for (const clip of ["FlightCruise", "GroundWalk", "BankLeft", "BankRight", "Takeoff"]) {
    assert.ok(V1_RIG_CLIPS.includes(clip));
  }
});

test("flight states resolve authored clips and degrade to generic flight clips", () => {
  assert.equal(resolveFlightLabClip("bank-left", ["idle", "cruise", "bankLeft"]), "bankLeft");
  assert.equal(resolveFlightLabClip("bank-right", ["idle", "glide"]), "glide");
  assert.equal(resolveFlightLabClip("cruise", []), null);
});

test("specimen catalog contains the v2 rig and v1 comparison specimen", () => {
  const wyverns = FLIGHT_LAB_SPECIMENS.filter((s) => s.kind === "wyvern");
  assert.ok(wyverns.some((w) => w.id === "wyvern-v2-membrane-candidate"));
  assert.ok(wyverns.some((w) => w.id === "wyvern-v2-rig"));
  assert.ok(wyverns.some((w) => w.id === "wyvern-v1-rig"));
  for (const w of wyverns) {
    assert.equal(w.kind, "wyvern");
    assert.ok(w.modelFile.endsWith(".glb"));
  }
});

test("specimen catalog search matches name, class, description, and kind", () => {
  const filter = (query) => {
    const q = query.toLowerCase().trim();
    return FLIGHT_LAB_SPECIMENS.filter((item) =>
      item.name.toLowerCase().includes(q) ||
      item.className.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.modelFile.toLowerCase().includes(q) ||
      item.kind.toLowerCase().includes(q)
    );
  };

  const v2Results = filter("v2");
  assert.ok(v2Results.length >= 1);
  assert.ok(v2Results.some((item) => item.id === "wyvern-v2-rig"));

  const v1Results = filter("v1");
  assert.ok(v1Results.length >= 1);
  assert.ok(v1Results.some((item) => item.id === "wyvern-v1-rig"));

  const rig1Results = filter("rig 1");
  assert.ok(rig1Results.length >= 1);
  assert.ok(rig1Results.some((item) => item.id === "wyvern-v1-rig"));

  const rig2Results = filter("rig 2");
  assert.ok(rig2Results.length >= 1);
  assert.ok(rig2Results.some((item) => item.id === "wyvern-v2-rig"));

  const unknownResults = filter("nonexistent-xyz-999");
  assert.equal(unknownResults.length, 0);
});

test("v2 rig exposes combat and reaction clips", () => {
  const combatClips = ["attack", "attack2", "attackAir2", "breath", "death"];
  for (const action of combatClips) {
    assert.ok(V2_RIG_CLIPS.includes(action), `Expected v2 rig to have clip ${action}`);
  }
});

test("resolveFlightLabClip supports all flight modes with graceful fallbacks", () => {
  const available = ["idle", "walk", "takeoff", "cruise", "bankLeft", "bankRight", "attack"];
  assert.equal(resolveFlightLabClip("ground", available), "idle");
  assert.equal(resolveFlightLabClip("takeoff", available), "takeoff");
  assert.equal(resolveFlightLabClip("cruise", available), "cruise");
  assert.equal(resolveFlightLabClip("bank-left", available), "bankLeft");
  assert.equal(resolveFlightLabClip("bank-right", available), "bankRight");
  assert.equal(resolveFlightLabClip("boost", available), "cruise");
});

test("resolveModeCapability and resolveOneShotCapability distinguish exact, alias, and unavailable", async () => {
  const { resolveModeCapability, resolveOneShotCapability } = await import("../src/flight-lab/clipResolver.ts");
  const available = ["walk", "cruise", "glide"];

  // Exact match
  const cruiseRes = resolveModeCapability("cruise", available);
  assert.equal(cruiseRes.status, "exact");
  assert.equal(cruiseRes.clipName, "cruise");

  // Alias match for ground (walk is secondary candidate after idle)
  const groundRes = resolveModeCapability("ground", available);
  assert.equal(groundRes.status, "alias");
  assert.equal(groundRes.clipName, "walk");

  // Strict mode rejects alias when requested
  const strictGround = resolveModeCapability("ground", available, true);
  assert.equal(strictGround.status, "unavailable");
  assert.equal(strictGround.clipName, null);

  // One-shot capability
  const attackRes = resolveOneShotCapability("attack", available);
  assert.equal(attackRes.status, "unavailable");
  assert.equal(attackRes.clipName, null);

  const walkOneShot = resolveOneShotCapability("walk", available);
  assert.equal(walkOneShot.status, "exact");
  assert.equal(walkOneShot.clipName, "walk");
});

test("MODE_CLIPS defines candidate mappings for all six flight modes", () => {
  const modes = ["ground", "takeoff", "cruise", "bank-left", "bank-right", "boost"];
  for (const mode of modes) {
    assert.ok(Array.isArray(MODE_CLIPS[mode]), `Expected MODE_CLIPS to have array for mode ${mode}`);
    assert.ok(MODE_CLIPS[mode].length > 0, `Expected candidate list for ${mode} to be non-empty`);
  }
});

test("computeMeshMetrics computes accurate triangle, vertex, and bounding metrics", () => {
  const boxGeom = new THREE.BoxGeometry(2, 4, 6);
  const mesh = new THREE.Mesh(boxGeom, new THREE.MeshBasicMaterial());
  const metrics = computeMeshMetrics(mesh);

  // A BoxGeometry has 12 triangles (2 per face * 6 faces)
  assert.equal(metrics.triangles, 12);
  assert.equal(metrics.vertices, 24);
  assert.equal(metrics.dimensions.width, 2);
  assert.equal(metrics.dimensions.height, 4);
  assert.equal(metrics.dimensions.depth, 6);
});

test("calculateEffectiveRate applies single playback rate and separates boost multiplier", () => {
  // At 1.0x base speed
  assert.equal(calculateEffectiveRate(1.0, "cruise"), 1.0);
  assert.equal(calculateEffectiveRate(1.0, "boost"), 1.45);
  assert.equal(calculateEffectiveRate(1.0, "ground"), 1.0);

  // At 0.5x base speed
  assert.equal(calculateEffectiveRate(0.5, "cruise"), 0.5);
  assert.equal(calculateEffectiveRate(0.5, "boost"), 0.725);

  // At 2.0x base speed
  assert.equal(calculateEffectiveRate(2.0, "cruise"), 2.0);
  assert.equal(calculateEffectiveRate(2.0, "boost"), 2.9);

  // Clamping to [0.25, 2.0]
  assert.equal(calculateEffectiveRate(0.1, "cruise"), 0.25);
  assert.equal(calculateEffectiveRate(5.0, "cruise"), 2.0);
});

test("synthetic clip advances by expected elapsed time at 0.5x, 1x, and 2x without compounding", () => {
  const root = new THREE.Object3D();
  const track = new THREE.NumberKeyframeTrack(".position[x]", [0, 10], [0, 100]);
  const clip = new THREE.AnimationClip("TestClip", 10.0, [track]);

  for (const speed of [0.5, 1.0, 2.0]) {
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.play();
    const effectiveRate = calculateEffectiveRate(speed, "cruise");
    action.setEffectiveTimeScale(effectiveRate);

    // Simulate 1.0s elapsed delta without compounding mixer.update
    mixer.update(1.0);
    assert.equal(
      Number(action.time.toFixed(4)),
      speed,
      `Expected action time to advance by ${speed}s at ${speed}x rate, got ${action.time}`
    );
  }
});

test("cruise-to-boost updates effective rate on the active action without resetting or skipping", () => {
  const root = new THREE.Object3D();
  const track = new THREE.NumberKeyframeTrack(".position[x]", [0, 5], [0, 50]);
  const clip = new THREE.AnimationClip("cruise", 5.0, [track]);

  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();

  // In cruise mode at 1.0x
  let effectiveRate = calculateEffectiveRate(1.0, "cruise");
  action.setEffectiveTimeScale(effectiveRate);
  assert.equal(action.getEffectiveTimeScale(), 1.0);

  // Advance 0.5s
  mixer.update(0.5);
  assert.equal(Number(action.time.toFixed(4)), 0.5);

  // Switch to boost mode while keeping the same clip
  effectiveRate = calculateEffectiveRate(1.0, "boost");
  action.setEffectiveTimeScale(effectiveRate);
  assert.equal(action.getEffectiveTimeScale(), 1.45);

  // Advance another 0.5s simulated delta
  mixer.update(0.5);
  // Expected advance = 0.5s * 1.45 = 0.725s -> total time = 0.5 + 0.725 = 1.225s
  assert.equal(Number(action.time.toFixed(4)), 1.225);
});

test("one-shot actions complete once, interruptions cancel mode return, and Death holds final pose", () => {
  const root = new THREE.Object3D();
  const track = new THREE.NumberKeyframeTrack(".position[y]", [0, 1], [0, 10]);
  const roarClip = new THREE.AnimationClip("attack", 1.0, [track]);
  const deathClip = new THREE.AnimationClip("death", 1.0, [track]);
  const cruiseClip = new THREE.AnimationClip("cruise", 2.0, [track]);

  // Scenario 1: One-shot completes and signals return to mode
  {
    const mixer = new THREE.AnimationMixer(root);
    const roarAction = mixer.clipAction(roarClip);
    let finishedFired = false;
    let returnedToMode = false;

    mixer.addEventListener("finished", (e) => {
      if (e.action === roarAction) {
        finishedFired = true;
        returnedToMode = true;
      }
    });

    roarAction.setLoop(THREE.LoopOnce, 1);
    roarAction.play();
    mixer.update(1.2);

    assert.ok(finishedFired, "Expected finished event to fire once on one-shot completion");
    assert.ok(returnedToMode, "Expected reaction one-shot to return to active flight mode");
  }

  // Scenario 2: Death action clamps and holds final pose without returning to mode
  {
    const mixer = new THREE.AnimationMixer(root);
    const deathAction = mixer.clipAction(deathClip);
    deathAction.setLoop(THREE.LoopOnce, 1);
    deathAction.clampWhenFinished = true;
    deathAction.play();

    let heldPose = false;
    mixer.addEventListener("finished", (e) => {
      if (e.action === deathAction) {
        // Death holds its final pose and pauses
        deathAction.paused = true;
        heldPose = true;
      }
    });

    mixer.update(1.2);
    assert.ok(heldPose, "Expected Death to hold final pose");
    assert.equal(deathAction.time, 1.0, "Expected Death action time to clamp at duration");
    assert.equal(root.position.y, 10, "Expected mesh to hold final frame transform");
  }

  // Scenario 3: Interruption clears one-shot return
  {
    const mixer = new THREE.AnimationMixer(root);
    const roarAction = mixer.clipAction(roarClip);
    const cruiseAction = mixer.clipAction(cruiseClip);

    let activeAction = roarAction;
    let isOneShot = true;
    let returnToModeCount = 0;

    mixer.addEventListener("finished", (e) => {
      if (e.action === activeAction && isOneShot) {
        returnToModeCount++;
      }
    });

    roarAction.setLoop(THREE.LoopOnce, 1);
    roarAction.play();
    mixer.update(0.3);

    // User interrupts by manually selecting cruise mode
    isOneShot = false;
    activeAction = cruiseAction;
    cruiseAction.play();

    // Now advance past roar's duration
    mixer.update(1.0);
    assert.equal(returnToModeCount, 0, "Expected interrupted one-shot not to trigger unexpected mode return");
  }
});

test("frame stepping calculates discrete steps based on inspection fps independent of speed scale", () => {
  const duration = 2.0;

  // Forward step with default 24fps: 1.0s + 1/24s = ~1.0417s
  const stepFwd24 = calculateFrameStepTime(1.0, 1, duration, true, 24);
  assert.equal(stepFwd24, Number((1.0 + 1 / 24).toFixed(4)));

  // Backward step with default 24fps: 1.0s - 1/24s = ~0.9583s
  const stepBack24 = calculateFrameStepTime(1.0, -1, duration, true, 24);
  assert.equal(stepBack24, Number((1.0 - 1 / 24).toFixed(4)));

  // Forward step with 60fps
  const stepFwd60 = calculateFrameStepTime(1.0, 1, duration, true, 60);
  assert.equal(stepFwd60, Number((1.0 + 1 / 60).toFixed(4)));

  // Looping wrap backward past 0
  const wrapBack = calculateFrameStepTime(0.005, -1, duration, true, 24);
  assert.ok(wrapBack > 1.9, `Expected wrap around duration, got ${wrapBack}`);

  // Non-looping clamp at 0
  const clampZero = calculateFrameStepTime(0.005, -1, duration, false, 24);
  assert.equal(clampZero, 0);

  // Non-looping clamp at duration
  const clampEnd = calculateFrameStepTime(1.995, 2, duration, false, 24);
  assert.equal(clampEnd, duration);
});

test("calculateClipTelemetry preserves 100% duration at completed non-looping endpoint", () => {
  const duration = 1.5;

  // Mid-clip non-looping
  const mid = calculateClipTelemetry(0.75, duration, false);
  assert.equal(mid.clipTime, 0.75);
  assert.equal(mid.clipProgress, 0.5);

  // Completed non-looping clip (time >= duration): must NOT wrap to 0%
  const end = calculateClipTelemetry(1.5, duration, false);
  assert.equal(end.clipTime, 1.5);
  assert.equal(end.clipProgress, 1.0);

  const overEnd = calculateClipTelemetry(1.65, duration, false);
  assert.equal(overEnd.clipTime, 1.5);
  assert.equal(overEnd.clipProgress, 1.0);

  // Looping clip wraps cleanly
  const loopMid = calculateClipTelemetry(2.25, duration, true);
  assert.equal(loopMid.clipTime, 0.75);
  assert.equal(loopMid.clipProgress, 0.5);
});

test("specimen capability rules reject flight modes and one-shots for eggs, allow for wyvern", () => {
  // Egg capability rejections
  assert.equal(canSpecimenExecuteMode("egg", "ground"), false);
  assert.equal(canSpecimenExecuteMode("egg", "cruise"), false);
  assert.equal(canSpecimenExecuteMode("egg", "boost"), false);
  assert.equal(canSpecimenExecuteOneShot("egg"), false);
  assert.equal(canSpecimenScrub("egg", 0), false);

  // Wyvern capabilities
  assert.equal(canSpecimenExecuteMode("wyvern", "ground"), true);
  assert.equal(canSpecimenExecuteMode("wyvern", "cruise"), true);
  assert.equal(canSpecimenExecuteMode("wyvern", "boost"), true);
  assert.equal(canSpecimenExecuteOneShot("wyvern"), true);
  assert.equal(canSpecimenScrub("wyvern", 6), true);

  // Death detection helper
  assert.ok(isDeathAction("death"));
  assert.ok(isDeathAction("fall"));
  assert.ok(isDeathAction("dragon_death_01"));
  assert.ok(!isDeathAction("attack"));
  assert.ok(!isDeathAction("breath"));

  // Keyboard shortcut editable detection
  const dummyInput = { tagName: "INPUT" };
  const dummyTextarea = { tagName: "TEXTAREA" };
  const dummySelect = { tagName: "SELECT" };
  const dummyDiv = { tagName: "DIV", isContentEditable: false };
  const dummyEditableDiv = { tagName: "DIV", isContentEditable: true };

  assert.ok(isEditableElement(dummyInput));
  assert.ok(isEditableElement(dummyTextarea));
  assert.ok(isEditableElement(dummySelect));
  assert.ok(isEditableElement(dummyEditableDiv));
  assert.ok(!isEditableElement(dummyDiv));
  assert.ok(!isEditableElement(null));

  // Shortcut uniqueness test
  const modeKeys = new Set(FLIGHT_LAB_SHORTCUTS.filter((s) => s.type === "mode").map((s) => s.key));
  const oneshotKeys = new Set(FLIGHT_LAB_SHORTCUTS.filter((s) => s.type === "oneshot").map((s) => s.key));
  for (const k of modeKeys) {
    assert.ok(!oneshotKeys.has(k), `Shortcut key collision detected between mode and oneshot: key ${k}`);
  }
});

test("scanSeam detects an injected rotation jump and stays silent on clean motion", () => {
  const root = new THREE.Object3D();
  const bone = new THREE.Bone();
  bone.name = "L_WingD0P2";
  root.add(bone);

  const identity = new THREE.Quaternion();
  const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(40));
  const flat = (q) => [q.x, q.y, q.z, q.w];

  // Mutant: 40° injected across a 0.01s gap (the frame-47/48 reset class of defect).
  const mutantClip = new THREE.AnimationClip("cruise", 2.0, [
    new THREE.QuaternionKeyframeTrack("L_WingD0P2.quaternion", [0, 1.0, 1.01, 2.0], [
      ...flat(identity), ...flat(identity), ...flat(turned), ...flat(turned),
    ]),
  ]);

  const cleanClip = new THREE.AnimationClip("clean", 2.0, [
    new THREE.QuaternionKeyframeTrack("L_WingD0P2.quaternion", [0, 1.0, 2.0], [
      ...flat(identity), ...flat(turned), ...flat(identity),
    ]),
  ]);

  const run = (clip) => {
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip);
    action.play();
    return scanSeam(mixer, action, root);
  };

  const jumps = run(mutantClip);
  assert.ok(jumps.length > 0, "Expected scanSeam to flag the injected 40° jump");
  const worst = jumps[0];
  assert.equal(worst.boneName, "L_WingD0P2");
  assert.equal(worst.jumpType, "interior");
  assert.ok(worst.angleDeg > 10, `Expected >10° jump, got ${worst.angleDeg}`);
  assert.ok(Math.abs(worst.time - 1.0) < 0.1, `Expected jump near t=1.0s, got ${worst.time}`);
  assert.ok(worst.provenance.includes("art direction/v2-rig-inspection"));

  assert.equal(run(cleanClip).length, 0, "Expected no jumps on smooth interpolated motion");

  // Loop closure test: non-matching end-to-start
  const nonClosingClip = new THREE.AnimationClip("nonClosing", 2.0, [
    new THREE.QuaternionKeyframeTrack("L_WingD0P2.quaternion", [0, 2.0], [
      ...flat(identity), ...flat(turned),
    ]),
  ]);
  const loopJumps = run(nonClosingClip);
  assert.ok(loopJumps.some((j) => j.jumpType === "loop_closure"), "Expected loop_closure jump for non-closing loop");

  // When isLooping is false (one-shot), loop closure should NOT flag an error
  const mixerOneShot = new THREE.AnimationMixer(root);
  const actionOneShot = mixerOneShot.clipAction(nonClosingClip);
  actionOneShot.play();
  const oneShotJumps = scanSeam(mixerOneShot, actionOneShot, root, 24, 0.25, false);
  assert.ok(!oneShotJumps.some((j) => j.jumpType === "loop_closure"), "One-shot action should not flag loop_closure jump");
});

test("stepping transitions playback to paused and resume restarts playback immediately", () => {
  const root = new THREE.Object3D();
  const track = new THREE.NumberKeyframeTrack(".position[x]", [0, 2], [0, 20]);
  const clip = new THREE.AnimationClip("testClip", 2.0, [track]);
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();

  // Initially playing
  let status = "playing";
  assert.equal(status, "playing");

  // Stepping pauses the action
  action.paused = true;
  action.time = calculateFrameStepTime(action.time, 1, clip.duration, true, 24);
  status = "paused";
  assert.equal(status, "paused");
  assert.equal(action.paused, true);

  // Resuming clears paused state immediately
  action.paused = false;
  status = "playing";
  assert.equal(status, "playing");
  assert.equal(action.paused, false);
});

test("canonical anatomical landmarks cover major dragon rig regions", async () => {
  const { CANONICAL_LANDMARKS, resolveAnatomicalLandmarks } = await import("../src/flight-lab/anatomicalMap.ts");
  assert.ok(CANONICAL_LANDMARKS.length >= 12);
  const categories = new Set(CANONICAL_LANDMARKS.map((l) => l.category));
  assert.ok(categories.has("head"));
  assert.ok(categories.has("wing_left"));
  assert.ok(categories.has("wing_right"));
  assert.ok(categories.has("tail"));

  // Build a dummy rig with head and wing joints
  const root = new THREE.Object3D();
  const headBone = new THREE.Bone();
  headBone.name = "Head";
  headBone.position.set(0, 2, 3);
  root.add(headBone);

  const lWingTip = new THREE.Bone();
  lWingTip.name = "L_WingD0P2";
  lWingTip.position.set(-6, 1, 0);
  root.add(lWingTip);

  const rWingTip = new THREE.Bone();
  rWingTip.name = "R_WingD0P2";
  rWingTip.position.set(6, 1, 0);
  root.add(rWingTip);

  root.updateMatrixWorld(true);

  const resolved = resolveAnatomicalLandmarks(root);
  assert.ok(resolved.some((r) => r.id === "head" && r.boneName === "Head"));
  assert.ok(resolved.some((r) => r.id === "l_wing_tip" && r.boneName === "L_WingD0P2"));
  assert.ok(resolved.some((r) => r.id === "r_wing_tip" && r.boneName === "R_WingD0P2"));
});

test("measureBilateralSymmetry detects wingtip height and span differences", async () => {
  const { measureBilateralSymmetry } = await import("../src/flight-lab/anatomicalMap.ts");

  const symDummy = [
    {
      id: "l_wing_tip",
      label: "Left Wingtip",
      category: "wing_left",
      boneName: "L_WingD0P2",
      bone: new THREE.Bone(),
      worldPosition: new THREE.Vector3(-6, 2, 0),
      localPosition: new THREE.Vector3(-6, 2, 0),
      rotationEulerDeg: new THREE.Vector3(),
      color: "#2563eb",
    },
    {
      id: "r_wing_tip",
      label: "Right Wingtip",
      category: "wing_right",
      boneName: "R_WingD0P2",
      bone: new THREE.Bone(),
      worldPosition: new THREE.Vector3(6, 2, 0),
      localPosition: new THREE.Vector3(6, 2, 0),
      rotationEulerDeg: new THREE.Vector3(),
      color: "#f43f5e",
    },
  ];

  const symResult = measureBilateralSymmetry(symDummy);
  assert.ok(symResult);
  assert.equal(symResult.deltaHeightMm, 0);
  assert.equal(symResult.deltaSpanMm, 0);
  assert.equal(symResult.symmetryScorePercent, 100);

  // Inject 200mm asymmetry on right wing
  symDummy[1].worldPosition.y = 2.2;
  const asymResult = measureBilateralSymmetry(symDummy);
  assert.ok(asymResult);
  assert.equal(asymResult.deltaHeightMm, 200);
  assert.ok(asymResult.symmetryScorePercent < 100);
});

test("createPinRecord and formatPinForAI produce structured human-to-AI prompt snippet", async () => {
  const { createPinRecord, formatPinForAI } = await import("../src/flight-lab/inspectionPins.ts");

  const landmark = {
    id: "l_wing_wrist",
    label: "Left Wing Wrist (Carpus)",
    category: "wing_left",
    boneName: "L_WingWrist",
    bone: new THREE.Bone(),
    worldPosition: new THREE.Vector3(-2.4, 1.2, 0.8),
    localPosition: new THREE.Vector3(-0.5, 0.2, 0.1),
    rotationEulerDeg: new THREE.Vector3(12.4, -45.2, 8.1),
    parentBoneName: "L_WingElbow",
    color: "#0284c7",
    bindQuaternion: new THREE.Quaternion(),
    mixerQuaternion: new THREE.Quaternion(),
    layers: {
      clipDeltaEulerDeg: new THREE.Vector3(12.4, -45.2, 8.1),
      proceduralDeltaEulerDeg: new THREE.Vector3(0, 0, 0),
      worldHorizonEulerDeg: new THREE.Vector3(-8.2, 3.1, 1.4),
      clipShare: 1,
    },
  };

  const pin = createPinRecord(
    1,
    landmark,
    { id: "wyvern-v2-rig", name: "Wyvern v2 Rig", modelFile: "public/models/wyvern-v2-rig.glb" },
    "FlightCruise",
    0.45,
    0.38,
    "downstroke",
    "Folding too abruptly"
  );

  assert.equal(pin.index, 1);
  assert.equal(pin.boneName, "L_WingWrist");
  assert.equal(pin.strokePhase, "downstroke");
  assert.ok(pin.aiSnippet.includes("[Wyvern Rig Pin #1: Left Wing Wrist (Carpus) | Bone: `L_WingWrist`]"));
  assert.ok(pin.aiSnippet.includes("- Specimen: Wyvern v2 Rig (`wyvern-v2-rig`)"));
  assert.ok(pin.aiSnippet.includes("FlightCruise"));
  assert.ok(pin.aiSnippet.includes("L_WingElbow"));
  // No splice suggestion for a wing bone — that script only rewrites the neck.
  assert.ok(!pin.aiSnippet.includes("splice_neck_head_channels"), "must not name a tool that cannot act on this bone");
});

// Task E2: a screenshot shows the symptom, not the layer. The pin has to say
// whether the baked clip or the procedural rig owns the pose, or the next
// session opens the wrong file.
test("a pin splits the pose between the baked clip and the procedural rig", async () => {
  const { resolveAnatomicalLandmarks } = await import("../src/flight-lab/anatomicalMap.ts");
  const { createPinRecord, formatPinForAI } = await import("../src/flight-lab/inspectionPins.ts");

  const root = new THREE.Object3D();
  const head = new THREE.Bone();
  head.name = "Head";
  root.add(head);

  const bindQ = new THREE.Quaternion();
  const mixerQ = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    THREE.MathUtils.degToRad(-21.1),
  );
  // q_final = q_mixer * q_procedural, so the split is exact and checkable.
  const proceduralQ = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    THREE.MathUtils.degToRad(9),
  );
  head.quaternion.copy(mixerQ).multiply(proceduralQ);

  const landmarks = resolveAnatomicalLandmarks(root, {
    bind: new Map([["Head", bindQ]]),
    mixer: new Map([["Head", mixerQ]]),
  });
  const landmark = landmarks.find((lm) => lm.id === "head");
  assert.ok(landmark, "the head landmark must resolve");

  assert.ok(
    Math.abs(landmark.layers.clipDeltaEulerDeg.x - -21.1) < 0.1,
    `clip delta pitch ${landmark.layers.clipDeltaEulerDeg.x}, expected -21.1`,
  );
  assert.ok(
    Math.abs(landmark.layers.proceduralDeltaEulerDeg.z - 9) < 0.1,
    `procedural delta roll ${landmark.layers.proceduralDeltaEulerDeg.z}, expected 9`,
  );
  assert.ok(
    Math.abs(landmark.layers.clipShare - 21.1 / 30.1) < 0.01,
    `clip share ${landmark.layers.clipShare}, expected ${21.1 / 30.1}`,
  );
  assert.ok(
    Math.abs(landmark.layers.worldHorizonEulerDeg.x - -21.1) < 0.5,
    `horizon pitch ${landmark.layers.worldHorizonEulerDeg.x}, expected about -21.1`,
  );

  const pin = createPinRecord(
    2,
    landmark,
    { id: "wyvern-v2-rig", name: "Wyvern v2", modelFile: "public/models/wyvern-v2-rig.glb" },
    "idle",
    1.25,
    0.25,
    "idle",
    "neck craned too high",
  );

  assert.equal(pin.frame, 30, "frame is clipTime * 24, rounded");
  const ticket = pin.aiSnippet;
  for (const label of [
    "Frame #30",
    "Bind Delta",
    "Procedural Delta",
    "World Horizon Pitch",
    "Culpability",
    "User Feedback: neck craned too high",
  ]) {
    assert.ok(ticket.includes(label), `ticket is missing "${label}":\n${ticket}`);
  }
  assert.ok(ticket.includes("70% from baked GLB track `idle` `Head.quaternion`"), ticket);
  assert.ok(ticket.includes("30% from `wyvernFlightRig`"), ticket);
  assert.ok(ticket.includes("splice_neck_head_channels.mjs"), "a neck bone must suggest the neck splice tool");

  // The note is the only part that changes after creation; the ticket must follow.
  pin.note = "still wrong after the splice";
  const regenerated = formatPinForAI(pin);
  assert.ok(regenerated.includes("User Feedback: still wrong after the splice"), regenerated);
  assert.ok(!regenerated.includes("neck craned too high"), "a stale note must not survive in the ticket");
});

test("formatDiagnosticsReport generates comprehensive report with symmetry, landmarks, and pins", async () => {
  const { formatDiagnosticsReport } = await import("../src/flight-lab/evidenceExport.ts");
  const { createPinRecord } = await import("../src/flight-lab/inspectionPins.ts");

  const specimen = {
    id: "wyvern-v2-rig",
    name: "Gothic Wyvern v2",
    modelFile: "wyvern-v2-rig.glb",
    className: "Dragon",
    kind: "wyvern",
    heading: 0,
    targetSize: 8,
    description: "V2 Rebuilt Rig",
  };

  const snapshot = {
    status: "playing",
    activeClip: "cruise",
    isLooping: true,
    isOneShot: false,
    isDeath: false,
    clipTime: 1.25,
    clipDuration: 3.5,
    clipProgress: 0.357,
    speedScale: 1.0,
    effectiveRate: 1.0,
    inspectionFps: 24,
  };

  const landmark = {
    id: "head",
    label: "Cranial Apex (Head)",
    category: "head",
    boneName: "Head",
    bone: new THREE.Bone(),
    worldPosition: new THREE.Vector3(0, 2, 4),
    localPosition: new THREE.Vector3(0, 0, 0),
    rotationEulerDeg: new THREE.Vector3(0, 0, 0),
    color: "#e11d48",
    bindQuaternion: new THREE.Quaternion(),
    mixerQuaternion: new THREE.Quaternion(),
    layers: {
      clipDeltaEulerDeg: new THREE.Vector3(0, 0, 0),
      proceduralDeltaEulerDeg: new THREE.Vector3(0, 0, 0),
      worldHorizonEulerDeg: new THREE.Vector3(0, 0, 0),
      clipShare: 0,
    },
  };

  const pin = createPinRecord(
    1,
    landmark,
    { id: specimen.id, name: specimen.name, modelFile: specimen.modelFile },
    "cruise",
    1.25,
    0.357,
    "downstroke"
  );

  const report = formatDiagnosticsReport({
    specimen,
    currentClip: "cruise",
    snapshot,
    mode: "cruise",
    strokePhase: "downstroke",
    symmetry: {
      deltaHeightMm: 12,
      deltaSpanMm: 8,
      symmetryAngleDeg: 0.5,
      symmetryScorePercent: 98,
    },
    landmarks: [landmark],
    pins: [pin],
  });

  assert.ok(report.includes("WYVERN FLIGHT LAB DIAGNOSTIC REPORT: Gothic Wyvern v2"));
  assert.ok(report.includes("--- BILATERAL SYMMETRY ---"));
  assert.ok(report.includes("Height Delta: 12 mm"));
  assert.ok(report.includes("--- KEY ANATOMICAL LANDMARKS ---"));
  assert.ok(report.includes("Cranial Apex (Head)"));
  assert.ok(report.includes("--- ACTIVE INSPECTION PINS (1) ---"));
  assert.ok(report.includes("Wyvern Rig Pin #1"));
});

test("flight lab camera: dynamic follow anchor, vertical tracking, and fitSpecimen", async () => {
  const { createFlightLabCamera } = await import("../src/flight-lab/camera.ts");
  const persp = new THREE.PerspectiveCamera(43, 16 / 9, 0.1, 180);
  const ortho = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 180);
  const cam = createFlightLabCamera(null, persp, ortho);

  cam.setPreset("chase");
  cam.setFollowMode("direct");
  cam.tick(0.016, undefined, new THREE.Vector3(0, 0, 0));
  const initPos = persp.position.clone();

  // Dynamic vertical tracking: anchor moves up by 5 units
  const anchor = new THREE.Vector3(0, 5, 0);
  cam.tick(0.016, undefined, anchor);
  assert.equal(Math.round(persp.position.y - initPos.y), 5);

  // Ortho preset activation and fitSpecimen
  cam.setPreset("frontOrtho");
  assert.equal(cam.isOrthoActive(), true);

  const box = new THREE.Box3(new THREE.Vector3(-10, -2, -5), new THREE.Vector3(10, 4, 5));
  cam.fitSpecimen(box, 1.2);
  assert.ok(cam.getCameraState().orthoSize >= 10);

  cam.dispose();
});

test("serializeInspectionPreset and parseInspectionPreset round-trip valid presets and reject malformed inputs", async () => {
  const { serializeInspectionPreset, parseInspectionPreset } = await import("../src/flight-lab/presetManager.ts");

  const validData = {
    presetName: "Wingbeat Fold Test",
    specimenId: "wyvern-v2-rig",
    mode: "cruise",
    clipName: "cruise",
    clipTime: 1.45,
    speedScale: 0.5,
    inspectionFps: 24,
    cameraState: {
      preset: "chase",
      isOrtho: false,
      orthoSize: 12,
      azimuth: 0.5,
      elevation: 0.2,
      distance: 22,
      targetX: 0,
      targetY: 0.8,
      followMode: "smooth",
    },
    theme: "dark",
    showSkeleton: true,
    showWireframe: false,
    showSilhouette: false,
    showStreamlines: true,
    showProbes: false,
    comparisonMode: "off",
  };

  const json = serializeInspectionPreset(validData);
  assert.ok(typeof json === "string");

  const parseResult = parseInspectionPreset(json);
  assert.equal(parseResult.success, true);
  if (parseResult.success) {
    assert.equal(parseResult.preset.specimenId, "wyvern-v2-rig");
    assert.equal(parseResult.preset.clipTime, 1.45);
    assert.equal(parseResult.preset.showSkeleton, true);
  }

  // Reject invalid / corrupt JSON
  const corruptResult = parseInspectionPreset("{ invalid json");
  assert.equal(corruptResult.success, false);

  // Reject unsupported version
  const badVersionResult = parseInspectionPreset(JSON.stringify({ version: 999 }));
  assert.equal(badVersionResult.success, false);
});

test("interactive flight controller: advances position, computes banking and acceleration, and clears course rings", async () => {
  const { createInteractiveFlightController } = await import("../src/flight-lab/interactiveFlight.ts");
  const flight = createInteractiveFlightController(new THREE.Vector3(0, 0, 0));

  flight.setActive(true);
  assert.equal(flight.isActive(), true);

  // Throttle forward for 1 second
  flight.setInput({ forward: true, boost: false });
  for (let i = 0; i < 20; i++) {
    flight.tick(0.05);
  }

  const posAfterCruise = flight.getPosition().clone();
  // Travelled forward in negative Z
  assert.ok(posAfterCruise.z < -5);

  // Turning left updates heading, roll and G-force
  flight.setInput({ left: true });
  flight.tick(0.1);
  const telemetry = flight.getTelemetry();
  assert.ok(telemetry.bankDeg !== 0);
  assert.ok(telemetry.gForce >= 1.0);

  // Frame-rate independence: 2 steps of 0.05s vs 1 step of 0.1s
  flight.reset();
  flight.setActive(true);
  flight.setInput({ forward: true });
  flight.tick(0.1);
  const singleStepPos = flight.getPosition().clone();

  flight.reset();
  flight.setActive(true);
  flight.setInput({ forward: true });
  flight.tick(0.05);
  flight.tick(0.05);
  const doubleStepPos = flight.getPosition().clone();

  assert.ok(Math.abs(singleStepPos.z - doubleStepPos.z) < 0.2);
});

test("canonical landmarks resolve V1 rig tail, pelvis, and spine Bip002 bones", async () => {
  const { CANONICAL_LANDMARKS } = await import("../src/flight-lab/anatomicalMap.ts");
  const pelvisLm = CANONICAL_LANDMARKS.find((lm) => lm.id === "pelvis");
  assert.ok(pelvisLm);
  assert.ok(pelvisLm.v1Bones.includes("Bip002-Pelvis_07"));

  const spineLm = CANONICAL_LANDMARKS.find((lm) => lm.id === "spine_mid");
  assert.ok(spineLm);
  assert.ok(spineLm.v1Bones.includes("Bip002-Spine2_010"));

  const tailRootLm = CANONICAL_LANDMARKS.find((lm) => lm.id === "tail_root");
  assert.ok(tailRootLm);
  assert.ok(tailRootLm.v1Bones.includes("Bip002-Tail_0214") || tailRootLm.v1Bones.includes("Bip002-Tail1_0215"));

  const tailMidLm = CANONICAL_LANDMARKS.find((lm) => lm.id === "tail_mid");
  assert.ok(tailMidLm);
  assert.ok(tailMidLm.v1Bones.includes("Bip002-Tail4_0218"));

  const tailTipLm = CANONICAL_LANDMARKS.find((lm) => lm.id === "tail_tip");
  assert.ok(tailTipLm);
  assert.ok(tailTipLm.v1Bones.includes("Bip002-Tail8_03"));
});

test("comparison rig and specimen positioning preserve base grounding offset across altitude changes", () => {
  // Simulate V2 (base Y ~ 0.05) and V1 (base Y ~ 4.33 due to rest bounds)
  const v2Base = new THREE.Vector3(0, 0.054, 1.4);
  const v1Base = new THREE.Vector3(0, 4.326, 0.68);

  const GROUND_ALT = -5.45;
  const FLIGHT_ALT = 0.0;

  // Primary model position at ground altitude
  const primaryModel = new THREE.Object3D();
  primaryModel.userData.basePosition = v2Base.clone();
  primaryModel.position.set(v2Base.x, v2Base.y + GROUND_ALT, v2Base.z);

  // Comparison model (V1) in ghost overlay
  const comparisonModel = new THREE.Object3D();
  comparisonModel.userData.basePosition = v1Base.clone();

  const primBase = primaryModel.userData.basePosition;
  const compBase = comparisonModel.userData.basePosition;
  const relY = primaryModel.position.y - primBase.y;

  comparisonModel.position.set(compBase.x, compBase.y + relY, compBase.z);

  // Both models have identical dynamic displacement (GROUND_ALT = -5.45)
  assert.equal(Number((primaryModel.position.y - primBase.y).toFixed(3)), GROUND_ALT);
  assert.equal(Number((comparisonModel.position.y - compBase.y).toFixed(3)), GROUND_ALT);

  // The bottom of V1 (whose local bounds start at -4.326) rests at:
  // comparisonModel.position.y - 4.326 = (4.326 - 5.45) - 4.326 = -5.45
  const v1LowestWorldY = comparisonModel.position.y - 4.326;
  assert.equal(Number(v1LowestWorldY.toFixed(2)), -5.45);
});

test("isV2RigSpecimen identifies all V2 Gothic rebuild specimens and excludes V1 reference", async () => {
  const { isV2RigSpecimen } = await import("../src/flight-lab/catalog.ts");
  assert.equal(isV2RigSpecimen("wyvern-v2-rig"), true);
  assert.equal(isV2RigSpecimen("wyvern-v2-locomotion-candidate"), true);
  assert.equal(isV2RigSpecimen("wyvern-v2-membrane-candidate"), true);
  assert.equal(isV2RigSpecimen({ id: "wyvern-v2-membrane-candidate" }), true);
  assert.equal(isV2RigSpecimen("wyvern-v1-rig"), false);
  assert.equal(isV2RigSpecimen(null), false);
});

test("resolvePhasePreservingCrossfadeTime preserves normalized wingbeat phase across flight phaseGroup loops", async () => {
  const { resolvePhasePreservingCrossfadeTime } = await import("../src/flight-lab/playback.ts");

  // V2 cruise (6.0s at t=1.5s -> 25% phase) -> bankLeft (6.0s) => 1.5s
  assert.equal(
    resolvePhasePreservingCrossfadeTime("cruise", "bankLeft", 1.5, 6.0, 6.0),
    1.5
  );

  // Wrapped looping time: cruise at t=7.5s on 6.0s clip -> 1.5s wrapped (25%) -> bankRight (6.0s) => 1.5s
  assert.equal(
    resolvePhasePreservingCrossfadeTime("cruise", "bankRight", 7.5, 6.0, 6.0),
    1.5
  );

  // V1 FlightCruise (4.0s at t=1.0s -> 25% phase) -> BankRight (2.0s) => 0.5s
  assert.equal(
    resolvePhasePreservingCrossfadeTime("FlightCruise", "BankRight", 1.0, 4.0, 2.0),
    0.5
  );

  // Non-flight-phaseGroup transitions reset to 0
  assert.equal(
    resolvePhasePreservingCrossfadeTime("takeoff", "cruise", 2.0, 3.0, 6.0),
    0
  );
  assert.equal(
    resolvePhasePreservingCrossfadeTime("cruise", "land", 3.0, 6.0, 3.0),
    0
  );
});


test("resolvePhasePreservingCrossfadeTime preserves phase across boost (speed) and aerial specialty loops", async () => {
  const { resolvePhasePreservingCrossfadeTime } = await import("../src/flight-lab/playback.ts");

  // Cruise (6.0s at t=3.0s -> 50% phase) -> speed (2.0s) => 1.0s
  assert.equal(
    resolvePhasePreservingCrossfadeTime("cruise", "speed", 3.0, 6.0, 2.0),
    1.0
  );
  // bankLeft (6.0s at t=1.5s -> 25% phase) -> glide (4.0s) => 1.0s
  assert.equal(
    resolvePhasePreservingCrossfadeTime("bankLeft", "glide", 1.5, 6.0, 4.0),
    1.0
  );
  // dive (2.0s at t=0.5s -> 25% phase) -> cruise (6.0s) => 1.5s
  assert.equal(
    resolvePhasePreservingCrossfadeTime("dive", "cruise", 0.5, 2.0, 6.0),
    1.5
  );
});

test("resolveClipFlightContext maps all 18 V2 clips to accurate mode, altitude class, and airspeed", async () => {
  const { resolveClipFlightContext } = await import("../src/flight-lab/playback.ts");
  assert.equal(typeof resolveClipFlightContext, "function", "Expected resolveClipFlightContext export");

  assert.deepEqual(resolveClipFlightContext("bankLeft"), { mode: "bank-left", airborne: true, airspeed: 18 });
  assert.deepEqual(resolveClipFlightContext("bankRight"), { mode: "bank-right", airborne: true, airspeed: 18 });
  assert.deepEqual(resolveClipFlightContext("speed"), { mode: "boost", airborne: true, airspeed: 36 });
  assert.deepEqual(resolveClipFlightContext("takeoff"), { mode: "takeoff", airborne: false, airspeed: 0 });
  assert.deepEqual(resolveClipFlightContext("land"), { mode: "land", airborne: true, airspeed: 18 });
  assert.deepEqual(resolveClipFlightContext("attackAir2"), { mode: "cruise", airborne: true, airspeed: 18 });
  assert.deepEqual(resolveClipFlightContext("dive"), { mode: "cruise", airborne: true, airspeed: 28 });
  assert.deepEqual(resolveClipFlightContext("glide"), { mode: "cruise", airborne: true, airspeed: 14 });
  assert.deepEqual(resolveClipFlightContext("hover"), { mode: "cruise", airborne: true, airspeed: 2 });
  assert.deepEqual(resolveClipFlightContext("scout"), { mode: "cruise", airborne: true, airspeed: 8 });
  assert.deepEqual(resolveClipFlightContext("walk"), { mode: "ground", airborne: false, airspeed: 4 });
  assert.deepEqual(resolveClipFlightContext("idle"), { mode: "ground", airborne: false, airspeed: 0 });
  assert.deepEqual(resolveClipFlightContext("attack2"), { mode: "ground", airborne: false, airspeed: 0 });
});


test("resolveAnatomicalLandmarks reuses cached landmark descriptors and Vector3 instances in-place across frames", async () => {
  const { resolveAnatomicalLandmarks } = await import("../src/flight-lab/anatomicalMap.ts");
  const root = new THREE.Object3D();
  const head = new THREE.Bone();
  head.name = "Head";
  head.position.set(1, 2, 3);
  root.add(head);
  root.updateMatrixWorld(true);

  const first = resolveAnatomicalLandmarks(root);
  assert.equal(first.length, 1);
  const firstEntry = first[0];
  const firstWorldVec = firstEntry.worldPosition;
  const firstLocalVec = firstEntry.localPosition;
  const firstRotVec = firstEntry.rotationEulerDeg;
  assert.equal(firstWorldVec.x, 1);

  // Move bone on next frame and re-resolve
  head.position.set(4, 5, 6);
  head.rotation.y = Math.PI / 2;
  root.updateMatrixWorld(true);

  const second = resolveAnatomicalLandmarks(root);
  assert.equal(second, first, "Expected cached landmark array reference to be reused per model root");
  assert.equal(second[0], firstEntry, "Expected cached landmark descriptor to be reused in-place");
  assert.equal(second[0].worldPosition, firstWorldVec, "Expected worldPosition Vector3 to be updated in-place");
  assert.equal(second[0].localPosition, firstLocalVec, "Expected localPosition Vector3 to be updated in-place");
  assert.equal(second[0].rotationEulerDeg, firstRotVec, "Expected rotationEulerDeg Vector3 to be updated in-place");
  assert.equal(second[0].worldPosition.x, 4);
  assert.equal(second[0].localPosition.y, 5);
  assert.ok(Math.abs(second[0].rotationEulerDeg.y - 90) < 1e-3);
});

test("candidate specimens differ from the promoted baseline or are marked as promoted aliases", async () => {
  const { createHash } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  const sha256Of = (file) =>
    createHash("sha256")
      .update(readFileSync(new URL(`../public/models/${file}`, import.meta.url)))
      .digest("hex");
  const baseline = FLIGHT_LAB_SPECIMENS.find((s) => s.id === "wyvern-v2-rig");
  const baselineSha = sha256Of(baseline.modelFile);
  for (const specimen of FLIGHT_LAB_SPECIMENS) {
    if (specimen.id === "wyvern-v2-rig" || specimen.kind !== "wyvern") continue;
    if (!specimen.id.startsWith("wyvern-v2-")) continue;
    const identical = sha256Of(specimen.modelFile) === baselineSha;
    assert.ok(
      !identical || specimen.promotedAliasOf === "wyvern-v2-rig",
      `${specimen.id} is byte-identical to the baseline but not marked as a promoted alias`,
    );
  }
});

// ---------------------------------------------------------------------------
// Pose-envelope detectors (Task E1)
//
// Every fixture below is the *shape* of a defect that shipped in the V2 rig and
// that `scanSeam` reported as clean, because the defect was constant across the
// clip and therefore had no frame-to-frame difference to measure:
//   - `idle` held a -65° neck raise (seam 0.0000°)
//   - `walk` held a +8.6° open jaw on a 2-key STEP track
//   - `land` ended 15.9° (Neck2) from where `idle` started — an inter-clip snap
//     that no single-clip scan can see at all.
// ---------------------------------------------------------------------------

const POSE_CHAIN_BONES = ["Body", "Spine1", "Spine2", "Spine3", "Neck1", "Neck2", "Head", "Jaw", "L_WingD0P2"];

/** A rig with identity bind rotations, so a clip rotation *is* the bind delta. */
function buildPoseFixture() {
  const root = new THREE.Object3D();
  const bones = new Map();
  for (const name of POSE_CHAIN_BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    root.add(bone);
    bones.set(name, bone);
  }
  const bind = {
    rotations: new Map([...bones].map(([name, bone]) => [name, bone.quaternion.clone()])),
  };
  return { root, bones, bind };
}

/** Constant local rotation about X for the named bones over `duration`. */
function heldPitchClip(name, held, duration = 2.0) {
  const tracks = Object.entries(held).map(([boneName, degrees]) => {
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      THREE.MathUtils.degToRad(degrees),
    );
    return new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, [0, duration], [
      q.x, q.y, q.z, q.w, q.x, q.y, q.z, q.w,
    ]);
  });
  return new THREE.AnimationClip(name, duration, tracks);
}

function sampleClip(root, clip) {
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  return { mixer, action };
}

test("pose envelope flags the pre-fix idle neck raise that the seam scan called clean", () => {
  const { root, bind } = buildPoseFixture();
  // Measured pre-fix `idle`: Neck1 -21.1°, Neck2 -24.2°, Head -19.3° vs bind,
  // on a Body pitched +12.9° — a -51.7° net head pitch held for the whole clip.
  const clip = heldPitchClip("idle", { Body: 12.9, Neck1: -21.1, Neck2: -24.2, Head: -19.3 });
  const { mixer, action } = sampleClip(root, clip);

  assert.equal(scanSeam(mixer, action, root).length, 0, "a held offset has no seam jump to find");

  const { anomalies } = scanClipAnomalies(root, clip, bind);
  const kinds = new Set(anomalies.map((a) => a.kind));
  assert.ok(kinds.has("bind_delta"), `expected a bind_delta anomaly, got ${JSON.stringify(anomalies)}`);
  assert.ok(kinds.has("horizon_pitch"), "expected the grounded head to fail the horizon envelope");

  const neck = anomalies.filter((a) => a.kind === "bind_delta").find((a) => a.boneName === "Neck1");
  assert.ok(neck, "Neck1 holds a -21.1° offset and must be named");
  assert.ok(Math.abs(neck.value + 21.1) < 0.5, `Neck1 measured ${neck.value}°, expected -21.1°`);

  const horizon = anomalies.find((a) => a.kind === "horizon_pitch");
  assert.ok(Math.abs(horizon.value + 51.7) < 0.5, `net head pitch ${horizon.value}°, expected -51.7°`);
});

test("pose envelope flags walk's held open jaw and stays silent once the jaw is closed", () => {
  const { root, bind } = buildPoseFixture();
  const run = (clip) => scanClipAnomalies(root, clip, bind).anomalies;

  const anomalies = run(heldPitchClip("walk", { Jaw: 8.6 }));
  const jaw = anomalies.find((a) => a.kind === "open_jaw");
  assert.ok(jaw, `expected an open_jaw anomaly, got ${JSON.stringify(anomalies)}`);
  assert.equal(jaw.boneName, "Jaw");
  assert.ok(Math.abs(jaw.value - 8.6) < 0.2, `jaw measured ${jaw.value}°, expected 8.6°`);

  // Mutant: the same clip with the jaw closed must produce nothing. This is the
  // control that proves the detector reads the jaw rather than always firing.
  assert.deepEqual(run(heldPitchClip("walk", { Jaw: 0 })), []);

  // A mouth clip is allowed to open: `attack` at 8.6° is authored intent.
  const mouthClip = run(heldPitchClip("attack", { Jaw: 8.6 }));
  assert.equal(mouthClip.filter((a) => a.kind === "open_jaw").length, 0, "mouth clips may open the jaw");
});

test("pose envelope ignores legitimate motion and exempt poses", () => {
  const { root, bind } = buildPoseFixture();
  const run = (clip) => scanClipAnomalies(root, clip, bind).anomalies;

  // A wing digit swinging 40° is motion, not posture: it is not on the postural
  // chain, so the envelope must not fire on the wingbeat of every flight clip.
  const beat = new THREE.AnimationClip("cruise", 2.0, [
    new THREE.QuaternionKeyframeTrack("L_WingD0P2.quaternion", [0, 1.0, 2.0], (() => {
      const a = new THREE.Quaternion();
      const b = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(40));
      return [a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w, a.x, a.y, a.z, a.w];
    })()),
  ]);
  assert.deepEqual(run(beat), []);

  // A death sprawl holds 30° of neck and is exempt by design.
  assert.deepEqual(run(heldPitchClip("death", { Neck1: 30 })), []);

  // The threshold is what decides: the same idle raise passes at 30°.
  const lenient = detectPoseAnomalies({
    clip: "idle",
    samples: scanClipAnomalies(root, heldPitchClip("idle", { Neck1: -21.1 }), bind).samples,
    bind,
    thresholds: { bindDeltaPitchDeg: 30, horizonPitchDeg: 30 },
  });
  assert.deepEqual(lenient, [], "raising the limit must silence the same measurement");
});

test("pose envelope flags a land -> idle handoff snap and a drifting Body", () => {
  const { root, bind } = buildPoseFixture();

  // `land` ended at Neck2 +15.9° against `idle`'s 0° start; both clips are
  // internally continuous, so only a boundary check can see it.
  const land = heldPitchClip("land", { Neck2: 15.9 });
  const idle = heldPitchClip("idle", { Neck2: 0 });
  const sampleOf = (clip) => scanClipAnomalies(root, clip, bind);

  const handoff = detectTransitionAnomalies({ from: sampleOf(land), to: sampleOf(idle) });
  const neck2 = handoff.find((a) => a.boneName === "Neck2");
  assert.ok(neck2, `expected a Neck2 handoff anomaly, got ${JSON.stringify(handoff)}`);
  assert.ok(Math.abs(neck2.value - 15.9) < 0.2, `handoff measured ${neck2.value}°, expected 15.9°`);
  assert.equal(neck2.clip, "land -> idle");

  // A handoff between clips that agree is silent.
  assert.deepEqual(detectTransitionAnomalies({ from: sampleOf(idle), to: sampleOf(idle) }), []);

  // Horizontal Body drift inside one clip.
  const drift = new THREE.AnimationClip("takeoff", 2.0, [
    new THREE.NumberKeyframeTrack("Body.position[x]", [0, 2.0], [0, 2.5]),
  ]);
  const anomalies = scanClipAnomalies(root, drift, bind).anomalies;
  const rootDrift = anomalies.find((a) => a.kind === "root_drift");
  assert.ok(rootDrift, `expected a root_drift anomaly, got ${JSON.stringify(anomalies)}`);
  assert.equal(rootDrift.unit, "rig");
  assert.ok(Math.abs(rootDrift.value - 2.5) < 0.05, `drift measured ${rootDrift.value}, expected 2.5`);
});

test("clip scan restores the pose it borrowed and repeats its measurement", () => {  const { root, bones, bind } = buildPoseFixture();
  const posed = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.75);
  bones.get("Neck1").quaternion.copy(posed);
  bones.get("Body").position.set(3, 4, 5);

  const clip = heldPitchClip("idle", { Neck1: -21.1 });
  const first = scanClipAnomalies(root, clip, bind);

  assert.ok(bones.get("Neck1").quaternion.equals(posed), "the scan must not leave the rig in the clip pose");
  assert.deepEqual(bones.get("Body").position.toArray(), [3, 4, 5]);

  // Second scan on the same model must measure the same thing. Doc 41
  // mis-attributed this to `action.paused`; what actually keeps it honest is
  // that `sampleClipPoses` builds a private mixer and restores the borrowed
  // pose, so the repeat starts from the same state.
  const second = scanClipAnomalies(root, clip, bind);
  assert.deepEqual(
    second.anomalies.map((a) => [a.kind, a.boneName, a.value]),
    first.anomalies.map((a) => [a.kind, a.boneName, a.value]),
    "a repeated scan must reproduce the first result",
  );
});

test("a scan reads the authored static pose even when the bone was left elsewhere", () => {
  const { root, bones, bind } = buildPoseFixture();
  // What a prior `scanSeam` / playback evaluation leaves behind: a pose the clip
  // does not author. A static 2-key track must still report its own value.
  const elsewhere = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    THREE.MathUtils.degToRad(37.5),
  );
  bones.get("Neck1").quaternion.copy(elsewhere);

  const { samples } = scanClipAnomalies(root, heldPitchClip("idle", { Neck1: -21.1 }), bind);
  const pitches = [
    ...new Set(
      samples.map((s) =>
        Number(
          THREE.MathUtils.radToDeg(
            new THREE.Euler().setFromQuaternion(s.rotations.get("Neck1"), "YXZ").x,
          ).toFixed(3),
        ),
      ),
    ),
  ];
  assert.deepEqual(pitches, [-21.1], "every sample must be the authored value, not the leftover pose");
  assert.ok(bones.get("Neck1").quaternion.equals(elsewhere), "the scan must restore the pose it borrowed");
});

// ---------------------------------------------------------------------------
// Three.js mixer mechanics that doc 41 §E1 states incorrectly.
//
// `AnimationAction._update` still accumulates while `paused` is true, and
// `PropertyMixer.apply` only calls `binding.setValue` when the accumulated value
// differs from the previous apply (three 0.185.1, PropertyMixer.js:231-242).
// Two consequences, measured rather than reasoned:
//
//   1. `action.paused = true` + `mixer.update(0)` DOES write a static 2-key
//      track. Doc 41 said it skips them; it does not.
//   2. A value written to a bound property from *outside* the mixer survives
//      every later `update(0)` while the clip's own value is constant, until
//      `flushMixerBindings` forces `setValue`.
//
// (1) is why a second Scan press re-measures the same jump; (2) is why
// `runtime.ts` calls `flushMixerBindings` every frame.
// ---------------------------------------------------------------------------
test("a paused action writes static tracks; only an outside write survives update(0)", () => {
  const root = new THREE.Object3D();
  const bone = new THREE.Bone();
  bone.name = "Neck1";
  root.add(bone);

  const held = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(-21.1));
  const clip = new THREE.AnimationClip("idle", 2.0, [
    new THREE.QuaternionKeyframeTrack("Neck1.quaternion", [0, 2.0], [
      held.x, held.y, held.z, held.w, held.x, held.y, held.z, held.w,
    ]),
  ]);
  const pitch = () =>
    Number(THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(bone.quaternion, "YXZ").x).toFixed(3));

  const mixer = new THREE.AnimationMixer(root);
  assert.equal(mixerBindingsAreSupported(mixer), true, "the flush depends on three's private binding fields");
  const action = mixer.clipAction(clip);
  action.play();
  mixer.update(0);

  // (1) a paused seek writes the static track.
  action.paused = true;
  action.time = 1.0;
  mixer.update(0);
  assert.equal(pitch(), -21.1, "a paused action must still write a static 2-key track");

  // (2) the trap: an outside write is not overwritten while the clip is constant.
  bone.quaternion.identity();
  mixer.update(0);
  assert.equal(pitch(), 0, "update(0) must not overwrite an outside write when the clip value is unchanged");

  // ...and the flush is what recovers it — runtime.ts's per-frame call.
  assert.equal(flushMixerBindings(mixer), 1);
  assert.equal(pitch(), -21.1, "flushMixerBindings must re-apply the accumulated clip value");
});

test("scanSeam measures the same defect on a repeated press", () => {
  const root = new THREE.Object3D();
  const bone = new THREE.Bone();
  bone.name = "L_WingD0P2";
  root.add(bone);

  const identity = new THREE.Quaternion();
  const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(40));
  const flat = (q) => [q.x, q.y, q.z, q.w];
  const clip = new THREE.AnimationClip("cruise", 2.0, [
    new THREE.QuaternionKeyframeTrack("L_WingD0P2.quaternion", [0, 1.0, 1.01, 2.0], [
      ...flat(identity), ...flat(identity), ...flat(turned), ...flat(turned),
    ]),
  ]);

  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  const summarise = (jumps) => jumps.map((j) => [j.boneName, j.jumpType, j.angleDeg]);

  const first = scanSeam(mixer, action, root);
  assert.ok(first.length > 0, "the injected 40° jump must be found");
  assert.deepEqual(summarise(scanSeam(mixer, action, root)), summarise(first), "second press must not go blind");

  // ...and not after real playback has advanced the borrowed action either.
  action.paused = false;
  mixer.update(0.37);
  assert.deepEqual(summarise(scanSeam(mixer, action, root)), summarise(first), "press after playback must match");
});

/** A `PoseAnomaly` with only the fields the overlay reads. */
function anomaly(kind, boneName, value, threshold = 18) {
  return { kind, clip: "idle", boneName, value, unit: "deg", threshold, frame: 0, time: 0, message: "" };
}

test("pose anomaly overlay rings each failing bone once, follows it, and pulses", () => {
  const scene = new THREE.Scene();
  const overlay = createPoseAnomalyOverlay(scene);

  const root = new THREE.Object3D();
  root.name = "rig";
  const neck = new THREE.Bone();
  neck.name = "Neck1";
  neck.position.set(0, 2, 0);
  const head = new THREE.Bone();
  head.name = "Head";
  head.position.set(0, 1, 0);
  neck.add(head);
  root.add(neck);
  scene.add(root);
  root.updateMatrixWorld(true);

  // `idle`'s historical defect: two bind-delta anomalies plus the cumulative
  // horizon line, all on three bones. `Tail9` does not exist in this fixture.
  overlay.setAnomalies(
    [
      anomaly("bind_delta", "Neck1", -24.7),
      anomaly("bind_delta", "Head", -21.1),
      anomaly("horizon_pitch", "Head", -60.0, 12),
      anomaly("bind_delta", "Tail9", -30.0),
    ],
    root,
  );

  assert.deepEqual(overlay.getRingedBones(), ["Neck1", "Head"], "one ring per bone, missing bones skipped");
  assert.equal(overlay.group.visible, true);

  const headRing = overlay.group.children.find((child) => child.name === "PoseAnomaly:Head");
  assert.ok(headRing, "Head must be ringed");
  assert.ok(Math.abs(headRing.position.y - 3) < 1e-6, `ring sat at y=${headRing.position.y}, expected 3`);

  const pulse = headRing.children[1];
  assert.equal(`#${pulse.material.color.getHexString()}`, POSE_ANOMALY_RING_COLOR);

  // The pulse must actually move: a static ring is decoration, not a sonar.
  const before = pulse.scale.x;
  overlay.tick(0.4);
  assert.notEqual(pulse.scale.x, before, "the pulse must expand between ticks");
  assert.ok(pulse.material.opacity >= 0 && pulse.material.opacity <= 1);

  // The ring is a bone follower, not a snapshot of where the bone was.
  neck.position.y = 5;
  root.updateMatrixWorld(true);
  overlay.tick(0.1);
  assert.ok(Math.abs(headRing.position.y - 6) < 1e-6, `ring did not follow the bone (y=${headRing.position.y})`);

  overlay.clear();
  assert.deepEqual(overlay.getRingedBones(), []);
  assert.equal(overlay.group.visible, false);

  // A clean scan must paint nothing at all.
  overlay.setAnomalies([], root);
  assert.equal(overlay.group.visible, false);
  overlay.dispose();
});

// `Scan` fires a one-shot `triggerPing` at each offending joint alongside the
// persistent ring, so the click itself points at the bone. The runtime call site
// needs a browser; this pins the part that can silently rot — that `triggerPing`
// honours the colour it is handed and lands on the position it is handed.
test("triggerPing spawns a ripple on the joint in the colour it is given", () => {
  const manager = createPingVisualManager();
  const joint = new THREE.Vector3(1, 2, 3);
  manager.triggerPing(joint, POSE_ANOMALY_RING_COLOR);

  assert.equal(manager.group.children.length, 2, "one ping is two staggered ripples");
  for (const ripple of manager.group.children) {
    assert.ok(ripple.position.equals(joint), `ripple at ${ripple.position.toArray()}, expected the joint`);
    assert.equal(`#${ripple.material.color.getHexString()}`, POSE_ANOMALY_RING_COLOR);
  }
  manager.dispose();
});


// `G` is the procedural-rig bypass (Task E3). It used to be Glide, so the
// collision was real and silent: whichever handler ran first won, and the other
// shortcut just stopped existing. This pins the table, which is the half a node
// test can reach — the handler order lives in `FlightLabClient.tsx`.
test("the procedural-rig toggle keeps G free and every locomotion key unique", () => {
  const keys = QUICK_LOCOMOTION_ACTIONS.map((action) => action.key.toUpperCase());
  assert.equal(new Set(keys).size, keys.length, `duplicate locomotion keys: ${keys.join(", ")}`);
  assert.ok(!keys.includes("G"), "G belongs to the rig toggle, not to a clip");
  assert.equal(
    QUICK_LOCOMOTION_ACTIONS.find((action) => action.name === "glide")?.key,
    "L",
    "Glide moved to L when G became the bypass; it must stay reachable",
  );
});

// --- Task E4: the dev evidence inbox -----------------------------------------
// The route itself is a thin fs wrapper; the parts that can silently rot are the
// validation (what gets written) and the ticket format (what an agent reads).

const validPngDataUrl = () =>
  `data:image/png;base64,${Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("fake-but-correctly-prefixed-png-body"),
  ]).toString("base64")}`;

const evidenceRequest = (overrides = {}) => ({
  captureId: "capture-wyvern-v2-rig-1",
  png: validPngDataUrl(),
  markdown: "# issue\n",
  telemetry: { version: "3.0" },
  ...overrides,
});

test("the inbox route refuses anything that is not a PNG data URL", () => {
  const ok = parseReportRequest(evidenceRequest());
  assert.equal(ok.ok, true, `a valid request was rejected: ${ok.ok ? "" : ok.error}`);
  assert.equal(isPngSignature(ok.value.pngBytes), true);

  const cases = [
    [{ png: "data:image/jpeg;base64,AAAA" }, /data:image\/png/],
    [{ png: "https://example.com/x.png" }, /data:image\/png/],
    [{ png: `data:image/png;base64,${Buffer.from("not a png at all").toString("base64")}` }, /signature/],
    [{ png: "data:image/png;base64," }, /empty/],
    [{ png: 42 }, /string/],
  ];
  for (const [override, expected] of cases) {
    const result = parseReportRequest(evidenceRequest(override));
    assert.equal(result.ok, false, `accepted a bad png: ${JSON.stringify(override).slice(0, 60)}`);
    assert.match(result.error, expected);
  }
});

test("the inbox route rejects an empty ticket and unserialisable telemetry", () => {
  assert.equal(parseReportRequest(evidenceRequest({ markdown: "   " })).ok, false);
  assert.equal(parseReportRequest(evidenceRequest({ markdown: undefined })).ok, false);

  const cyclic = { a: 1 };
  cyclic.self = cyclic;
  const result = parseReportRequest(evidenceRequest({ telemetry: cyclic }));
  assert.equal(result.ok, false);
  assert.match(result.error, /telemetry/);

  // `telemetry` is optional; a missing one must not become an error.
  assert.equal(parseReportRequest(evidenceRequest({ telemetry: undefined })).ok, true);
});

test("the inbox writes to fixed paths inside the repo", () => {
  // The route never takes a path from the caller; these constants are the only
  // destination it knows. If they move, the README and the UI copy must move too.
  assert.equal(ISSUE_PATH, "docs/flight-lab/inbox/latest-issue.md");
  assert.equal(CAPTURE_PATH, "docs/flight-lab/inbox/latest-capture.png");
  assert.equal(TELEMETRY_PATH, "docs/flight-lab/inbox/latest-capture.json");
});

test("the exported issue document is a self-contained ticket", () => {
  const pin = {
    id: "pin-1",
    index: 1,
    label: "Right Calf",
    boneName: "R_Calf",
    frame: 7,
    note: "knee folds backwards on the upstroke",
    aiSnippet: "[Wyvern Rig Pin #1: Right Calf | Bone: `R_Calf`]\n- Bind Delta: 15.0°",
  };
  const markdown = buildEvidenceMarkdown({
    specimen: { id: "wyvern-v2-rig", name: "V2 Rig", modelFile: "public/models/wyvern-v2-rig.glb" },
    currentClip: "cruise",
    snapshot: {
      status: "playing",
      activeClip: "cruise",
      isLooping: true,
      isOneShot: false,
      isDeath: false,
      clipTime: 1.35,
      clipDuration: 3.5,
      clipProgress: 0.386,
      speedScale: 1,
      effectiveRate: 1,
      inspectionFps: 12,
    },
    mode: "cruise",
    comparisonMode: "raw",
    cameraState: { preset: "chase", distance: 12.5 },
    strokePhase: "glide",
    symmetry: { symmetryScorePercent: 98, deltaHeightMm: 2, deltaSpanMm: 4 },
    landmarks: [],
    pins: [pin],
    anomalies: [
      {
        kind: "bind_delta",
        clip: "cruise",
        boneName: "Neck1",
        value: -21.1,
        unit: "deg",
        threshold: 18,
        frame: 32,
        time: 1.35,
        message: "held -21.1°",
      },
    ],
    proceduralRigEnabled: true,
    captureId: "capture-wyvern-v2-rig-1",
    generatedAt: "2026-10-22T08:00:00.000Z",
  });

  // The frame number is the join between the ticket and Blender's timeline.
  assert.match(markdown, /Frame \| #32 @ 24 fps/);
  assert.match(markdown, /frame #32/);
  // The note has to survive: it is the only part a human authored.
  assert.match(markdown, /knee folds backwards on the upstroke/);
  // The pin ticket is embedded verbatim, not re-derived.
  assert.match(markdown, /Bind Delta: 15\.0°/);
  // Culpability context, the scan, and the pointer to the pixels.
  assert.match(markdown, /Procedural Delta/);
  assert.match(markdown, /Pose envelope scan — `cruise`/);
  assert.match(markdown, /\| bind_delta \| cruise \| `Neck1` \| -21\.1° \| 18\.0° \| #32 \| 1\.35s \|/);
  assert.match(markdown, /docs\/flight-lab\/inbox\/latest-capture\.png/);
  assert.match(markdown, /docs\/flight-lab\/inbox\/latest-capture\.json/);
  assert.match(markdown, /Procedural rig \| ON/);
  // The catalogue stores a bare filename; the ticket has to give an openable path.
  assert.match(markdown, /`public\/models\/wyvern-v2-rig\.glb`/);
  // Pin frame 7 vs canvas frame 32 must read as two facts, not a contradiction.
  assert.match(markdown, /The canvas is at frame #32; each pin below names the frame it was taken at\./);
});

test("a ticket with no pin still names the joints furthest from bind", () => {
  const layer = (x, y, z) => ({ clipDeltaEulerDeg: { x, y, z }, proceduralDeltaEulerDeg: { x: 0, y: 0, z: 0 }, worldHorizonEulerDeg: { x: 3, y: 0, z: 0 }, clipShare: 1 });
  const landmark = (boneName, clip) => ({
    id: boneName.toLowerCase(),
    label: boneName,
    boneName,
    category: "spine",
    worldPosition: { x: 0, y: 0, z: 0 },
    rotationEulerDeg: { x: 0, y: 0, z: 0 },
    layers: layer(clip, 0, 0),
  });
  const markdown = buildEvidenceMarkdown({
    specimen: { id: "wyvern-v2-rig", name: "V2 Rig", modelFile: "public/models/wyvern-v2-rig.glb" },
    currentClip: "idle",
    snapshot: {
      status: "paused", activeClip: "idle", isLooping: true, isOneShot: false, isDeath: false,
      clipTime: 0.5, clipDuration: 2, clipProgress: 0.25, speedScale: 1, effectiveRate: 1, inspectionFps: 12,
    },
    mode: "ground",
    comparisonMode: "off",
    cameraState: { preset: "chase", distance: 10 },
    strokePhase: "idle",
    symmetry: null,
    landmarks: [landmark("Neck1", -21.1), landmark("Head", -19.3), landmark("Tail2", 2)],
    pins: [],
    anomalies: [],
    proceduralRigEnabled: false,
    captureId: "capture-1",
    generatedAt: "2026-10-22T08:00:00.000Z",
  });

  assert.match(markdown, /No inspection pins/);
  assert.match(markdown, /No findings/);
  assert.match(markdown, /Procedural rig \| OFF/);
  // Sorted by deviation: Neck1 (21.1) before Head (19.3) before Tail2 (2).
  const order = ["`Neck1`", "`Head`", "`Tail2`"].map((needle) => markdown.indexOf(needle));
  assert.ok(order[0] < order[1] && order[1] < order[2], `joint table is not sorted: ${order}`);
});

// --- Task FL-5: contract at load, mixer bindings, unified clip resolution ----

// `flushMixerBindings` exists because `PropertyMixer.apply` only calls
// `setValue` when the accumulated value *changed*: after an outside write, a
// paused `update(0)` leaves the bone holding the outside value forever. The test
// reproduces exactly that, because a version of this function that silently does
// nothing would still pass a "returns a number" assertion.
test("flushMixerBindings re-applies a static track that update(0) skipped", () => {
  const root = new THREE.Group();
  const bone = new THREE.Object3D();
  bone.name = "Bone";
  root.add(bone);

  const authored = new THREE.Quaternion(0, 0, 0, 1);
  const clip = new THREE.AnimationClip("static", 1, [
    new THREE.QuaternionKeyframeTrack("Bone.quaternion", [0, 1], [...authored.toArray(), ...authored.toArray()]),
  ]);
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clip).play();
  mixer.update(0);

  assert.equal(mixerBindingsAreSupported(mixer), true, "this three.js version exposes the fields we reach into");
  assert.ok(Math.abs(bone.quaternion.w - 1) < 1e-6, "the clip wrote the authored pose");

  // An outside write (the procedural rig multiplying an offset in, a pin drag…).
  bone.quaternion.set(0.5, 0, 0, 0.5).normalize();
  mixer.update(0);
  assert.ok(bone.quaternion.x > 0.4, "update(0) does NOT overwrite the outside write — the bug this guards");

  const flushed = flushMixerBindings(mixer);
  assert.ok(flushed > 0, `flush reported no bindings (${flushed})`);
  assert.ok(Math.abs(bone.quaternion.x) < 1e-6 && Math.abs(bone.quaternion.w - 1) < 1e-6,
    `flush did not restore the authored pose (${bone.quaternion.toArray()})`);

  mixer.stopAllAction();
  mixer.uncacheRoot(root);
});

test("mixerBindingsAreSupported reports a moved private API instead of throwing", () => {
  // A future three.js that renames `_bindings` must read as "unsupported", not
  // as a crash — the load path surfaces it as contract drift.
  const impostor = { update() {}, _accuIndex: 0 };
  assert.equal(mixerBindingsAreSupported(impostor), false);
  assert.equal(flushMixerBindings(impostor), 0, "an unsupported mixer flushes nothing rather than throwing");
});

test("the alias table lives in one place and still resolves V1 spellings", () => {
  // It used to be a 17-entry copy inside runtime.ts. The count is pinned so a
  // later "cleanup" cannot quietly delete entries the V1 asset depends on.
  assert.equal(Object.keys(CLIP_ALIASES).length, 17);

  assert.equal(resolveClipAlias("walk", V1_RIG_CLIPS), "GroundWalk");
  assert.equal(resolveClipAlias("cruise", V1_RIG_CLIPS), "FlightCruise");
  assert.equal(resolveClipAlias("attack", V1_RIG_CLIPS), "AttackBite");
  assert.equal(resolveClipAlias("attack2", V1_RIG_CLIPS), "AttackClaw");
  assert.equal(resolveClipAlias("idle", V1_RIG_CLIPS), "Idle");
  assert.equal(resolveClipAlias("cruise", V2_RIG_CLIPS), "cruise");
  assert.equal(resolveClipAlias("walk", V2_RIG_CLIPS), "walk");
  assert.equal(resolveClipAlias("nothing-like-this", V2_RIG_CLIPS), null);
});

test("every V2 mode resolves exactly; the V1 asset has to admit substitutions", () => {
  const v2 = resolveAllModeCapabilities(V2_RIG_CLIPS);
  for (const mode of Object.keys(MODE_CLIPS)) {
    assert.equal(v2[mode].status, "exact", `V2 mode "${mode}" should be exact, got ${v2[mode].status} (${v2[mode].clipName})`);
  }

  // V1 is the asset the badge exists for. Measured matrix: cruise and boost fall
  // back to FlightCruise, and `land` — the one that matters — plays `Idle`,
  // because V1 never had a landing clip. That used to happen with no UI at all.
  const v1 = resolveAllModeCapabilities(V1_RIG_CLIPS);
  const inexact = Object.entries(v1)
    .filter(([, result]) => result.status !== "exact")
    .map(([mode, result]) => `${mode}:${result.status}→${result.clipName}`)
    .sort();
  assert.deepEqual(inexact, ["boost:alias→FlightCruise", "cruise:alias→FlightCruise", "land:alias→Idle"]);
  assert.equal(v1.land.reason.includes("Idle"), true, "the badge tooltip must name the substitute clip");

  // And when nothing in the alias chain exists, the status has to say `fallback`
  // rather than pretending the last resort was a match.
  const bare = resolveAllModeCapabilities(["Takeoff"]);
  assert.equal(bare.land.status, "fallback");
  assert.equal(bare.land.clipName, "Takeoff");
  assert.equal(resolveAllModeCapabilities([]).land.status, "unavailable");
});

test("the contract guard names what drifted, and stays quiet on a clean V2 load", () => {
  const makeModel = (jointCount) => {
    const bones = Array.from({ length: jointCount }, (_, index) => {
      const bone = new THREE.Bone();
      bone.name = `Bone${index}`;
      return bone;
    });
    const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    mesh.name = "Body";
    mesh.bind(new THREE.Skeleton(bones));
    const root = new THREE.Group();
    root.add(mesh);
    return root;
  };

  const v2Specimen = findFlightLabSpecimen("wyvern-v2-rig");
  const mixer = new THREE.AnimationMixer(new THREE.Group());

  assert.equal(countSkinJoints(makeModel(V2_RIG_JOINT_COUNT)), V2_RIG_JOINT_COUNT);
  assert.deepEqual(
    validateLoadedContract({ specimen: v2Specimen, model: makeModel(V2_RIG_JOINT_COUNT), clipNames: V2_RIG_CLIPS, mixer }),
    [],
    "a clean V2 load must not raise a banner",
  );

  const drifted = validateLoadedContract({
    specimen: v2Specimen,
    model: makeModel(88),
    clipNames: V2_RIG_CLIPS.filter((name) => name !== "land").concat("legacyHover"),
    mixer,
  });
  assert.equal(drifted.length, 3, `expected 3 issues, got ${drifted.length}: ${drifted.join(" | ")}`);
  assert.match(drifted[0], /88 joints; the contract pins 92/);
  assert.match(drifted[1], /Missing 1 of 18 contract clips: land/);
  assert.match(drifted[2], /does not list: legacyHover/);

  // A moved private API is drift too, and it is reported for any specimen.
  const impostor = { update() {}, _accuIndex: 0 };
  const apiDrift = validateLoadedContract({ specimen: v2Specimen, model: makeModel(92), clipNames: V2_RIG_CLIPS, mixer: impostor });
  assert.equal(apiDrift.length, 1);
  assert.match(apiDrift[0], /flushMixerBindings/);

  // V1 is not held to the V2 clip set — only the mixer check applies to it.
  assert.deepEqual(
    validateLoadedContract({
      specimen: findFlightLabSpecimen("wyvern-v1-rig"),
      model: makeModel(88),
      clipNames: V1_RIG_CLIPS,
      mixer,
    }),
    [],
  );

  // Nor are the V2 *candidates*: they are deliberately partial (a couple of
  // clips, sometimes fewer bones), so a banner on every switch would be noise
  // that trains the user to ignore the real one.
  const candidate = findFlightLabSpecimen("wyvern-v2-locomotion-candidate");
  assert.ok(candidate.modelFile.includes("candidate"), "the candidate is not the pinned file");
  assert.deepEqual(
    validateLoadedContract({ specimen: candidate, model: makeModel(88), clipNames: ["idle", "walk"], mixer }),
    [],
    "a partial candidate must not be reported as contract drift",
  );
});

test("the V2 joint count and clip list are pinned to the contract file", () => {
  // `V2_RIG_JOINT_COUNT` is a duplicate of the contract JSON, because that file
  // is 215 KB of node signature and the browser only needs the number. This is
  // the test that makes the duplicate safe: it cannot drift from the contract.
  const contract = JSON.parse(
    readFileSync(new URL("../scripts/blender/wyvern_v2_runtime_contract.json", import.meta.url), "utf8"),
  );
  assert.equal(contract.signature.bones.length, V2_RIG_JOINT_COUNT, "V2_RIG_JOINT_COUNT drifted from the contract");
  assert.equal(contract.asset.path, `public/models/${PINNED_RUNTIME_MODEL}`, "PINNED_RUNTIME_MODEL drifted from the contract");
  assert.deepEqual(
    contract.signature.clips.map((clip) => clip.name).sort(),
    [...V2_RIG_CLIPS].sort(),
    "V2_RIG_CLIPS drifted from the contract",
  );
});
