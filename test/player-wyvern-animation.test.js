import test from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { readGlb } from "../tools/model-manifest-utils.mjs";
import { resolvePlayerWyvernAnimation } from "../src/game/playerWyvernModel.ts";

const modelUrl = new URL("../public/models/player-wyvern.glb", import.meta.url);
const expectedClips = [
  "AttackBite", "AttackClaw", "BankLeft", "BankRight", "Death",
  "FlightCruise", "GroundTurnLeft", "GroundTurnRight", "GroundWalk",
  "Hit", "Idle", "Roar", "Takeoff"
];

test("player wyvern ships its curated Blender animation set within the runtime budget", () => {
  const metadata = readGlb(modelUrl);
  assert.deepEqual(metadata.animations.sort(), [...expectedClips].sort());
  assert.equal(metadata.triangles, 39_234);
  assert.ok(statSync(modelUrl).size < 30 * 1024 * 1024);
});

test("player wyvern flight preview maps locomotion and bank states to clips", () => {
  assert.equal(resolvePlayerWyvernAnimation({ airborne: false, boosting: false, speed: 0, roll: 0 }), "Idle");
  assert.equal(resolvePlayerWyvernAnimation({ airborne: false, boosting: false, speed: 2, roll: 0 }), "GroundWalk");
  assert.equal(resolvePlayerWyvernAnimation({ airborne: true, boosting: false, speed: 14, roll: 0 }), "FlightCruise");
  assert.equal(resolvePlayerWyvernAnimation({ airborne: true, boosting: false, speed: 14, roll: 0.3 }), "BankLeft");
  assert.equal(resolvePlayerWyvernAnimation({ airborne: true, boosting: true, speed: 24, roll: -0.3 }), "BankRight");

  const v2Clips = ["idle", "walk", "cruise", "bankLeft", "bankRight", "speed", "takeoff"];
  assert.equal(resolvePlayerWyvernAnimation({ airborne: false, boosting: false, speed: 0, roll: 0 }, v2Clips), "idle");
  assert.equal(resolvePlayerWyvernAnimation({ airborne: false, boosting: false, speed: 2, roll: 0 }, v2Clips), "walk");
  assert.equal(resolvePlayerWyvernAnimation({ airborne: true, boosting: false, speed: 14, roll: 0 }, v2Clips), "cruise");
  assert.equal(resolvePlayerWyvernAnimation({ airborne: true, boosting: true, speed: 28, roll: 0 }, v2Clips), "speed");
  assert.equal(resolvePlayerWyvernAnimation({ airborne: true, boosting: false, speed: 14, roll: 0.3 }, v2Clips), "bankLeft");
  assert.equal(resolvePlayerWyvernAnimation({ airborne: true, boosting: true, speed: 24, roll: -0.3 }, v2Clips), "bankRight");
});


test("player wyvern V2 clip resolver maps dive, glide, and hover states when V2 clips are present", () => {
  const v2Clips = [
    "idle", "walk", "cruise", "bankLeft", "bankRight",
    "speed", "takeoff", "land", "dive", "glide", "hover"
  ];
  // Steep nose-down dive or fast vertical descent -> dive
  assert.equal(
    resolvePlayerWyvernAnimation({ airborne: true, boosting: false, speed: 22, roll: 0, pitch: -0.45, verticalSpeed: -8 }, v2Clips),
    "dive"
  );
  // Gentle unpowered descent -> glide
  assert.equal(
    resolvePlayerWyvernAnimation({ airborne: true, boosting: false, speed: 14, roll: 0, pitch: -0.1, verticalSpeed: -2.5 }, v2Clips),
    "glide"
  );
  // Stationary/low-speed airborne -> hover
  assert.equal(
    resolvePlayerWyvernAnimation({ airborne: true, boosting: false, speed: 1.5, roll: 0, pitch: 0, verticalSpeed: 0 }, v2Clips),
    "hover"
  );
});
