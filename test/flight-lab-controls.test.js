import assert from "node:assert/strict";
import test from "node:test";
import {
  categorizeClip,
  filterClips,
  formatTimecode,
  formatBubbleTime,
  CLIP_CATEGORIES,
  QUICK_LOCOMOTION_ACTIONS,
} from "../src/flight-lab/controlHelpers.ts";

test("categorizeClip classifies clips accurately into flight, locomotion, combat, and reaction", () => {
  assert.equal(categorizeClip("cruise"), "flight");
  assert.equal(categorizeClip("bankLeft"), "flight");
  assert.equal(categorizeClip("takeoff"), "flight");
  assert.equal(categorizeClip("glide"), "flight");

  assert.equal(categorizeClip("walk"), "locomotion");
  assert.equal(categorizeClip("idle"), "locomotion");
  assert.equal(categorizeClip("groundWalk"), "locomotion");

  assert.equal(categorizeClip("attack"), "combat");
  assert.equal(categorizeClip("attackAir2"), "combat");
  assert.equal(categorizeClip("breath"), "combat");

  assert.equal(categorizeClip("death"), "reaction");
  assert.equal(categorizeClip("hit"), "reaction");
});

test("filterClips filters by category and search query", () => {
  const clips = [
    { name: "cruise", duration: 2.0 },
    { name: "bankLeft", duration: 1.5 },
    { name: "walk", duration: 1.2 },
    { name: "attack", duration: 1.8 },
    { name: "death", duration: 2.5 },
  ];

  const all = filterClips(clips, "all");
  assert.equal(all.length, 5);

  const flight = filterClips(clips, "flight");
  assert.equal(flight.length, 2);
  assert.ok(flight.some((c) => c.name === "cruise"));
  assert.ok(flight.some((c) => c.name === "bankLeft"));

  const combat = filterClips(clips, "combat");
  assert.equal(combat.length, 1);
  assert.equal(combat[0].name, "attack");

  const queryMatch = filterClips(clips, "all", "bank");
  assert.equal(queryMatch.length, 1);
  assert.equal(queryMatch[0].name, "bankLeft");

  const none = filterClips(clips, "flight", "walk");
  assert.equal(none.length, 0);
});

test("formatTimecode formats second and frame metrics cleanly", () => {
  const result = formatTimecode(1.5, 3.0, 24);
  assert.equal(result, "1.50s / 3.00s (f36/72 @ 24fps)");

  const bubble = formatBubbleTime(0.75, 24);
  assert.equal(bubble, "0.75s · f18");
});

test("CLIP_CATEGORIES exposes all 5 canonical filter options", () => {
  assert.equal(CLIP_CATEGORIES.length, 5);
  assert.deepEqual(
    CLIP_CATEGORIES.map((c) => c.id),
    ["all", "flight", "locomotion", "combat", "reaction"]
  );
});

test("QUICK_LOCOMOTION_ACTIONS contains walk, idle, rest, hover, scout, glide, and dive with distinct shortcuts", () => {
  assert.ok(QUICK_LOCOMOTION_ACTIONS.length >= 7);
  const actionNames = QUICK_LOCOMOTION_ACTIONS.map((a) => a.name);
  assert.ok(actionNames.includes("walk"));
  assert.ok(actionNames.includes("idle"));
  assert.ok(actionNames.includes("rest"));
  assert.ok(actionNames.includes("hover"));
  assert.ok(actionNames.includes("scout"));
  assert.ok(actionNames.includes("glide"));
  assert.ok(actionNames.includes("dive"));

  // Keys must be unique uppercase letters
  const keys = QUICK_LOCOMOTION_ACTIONS.map((a) => a.key);
  const uniqueKeys = new Set(keys);
  assert.equal(uniqueKeys.size, keys.length);
  for (const k of keys) {
    assert.match(k, /^[A-Z]$/);
  }
});

