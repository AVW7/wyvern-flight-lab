#!/usr/bin/env node
/**
 * E3 probe: does `Proc` actually bypass the procedural rig, and does `Raw` ghost
 * the same specimen without it?
 *
 * "Immediate visual A/B switching" is a claim about pixels, so the honest test
 * is a measurement of the pose, not a screenshot. The FL-2 layer instrumentation
 * already answers it: with the rig on, a pin on `R_Calf` splits clip vs
 * procedural; with the rig off, the procedural half must be exactly zero and the
 * bone quaternion must actually move.
 *
 *   1. pin `R_Calf` with Proc ON  -> procedural delta > 0
 *   2. click `Proc` (or press G)  -> badge flips to RAW CLIP, pin again -> 0
 *   3. compare the bone quaternion between the two states -> non-zero angle
 *   4. engage `Raw` ghost         -> ghost is the same specimen, and its bone
 *      pose matches the raw (rig-off) primary, not the procedural one
 *
 * Run: node scripts/probe-proc-toggle.mjs [--base http://localhost:3010]
 */

import { chromium } from "/Users/ajadvanwyk/.workbuddy-ai/binaries/node/workspace/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = flag("--base", "http://localhost:3010");

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${message}`);
  if (!ok) failures.push(message);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("pageerror", (error) => console.log(`page error: ${error.message}`));

await page.goto(`${BASE}/flight-lab`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => {
    const bridge = window.__flightLab;
    if (!bridge) return false;
    const snapshot = bridge.runtime.getPlaybackSnapshot();
    return bridge.getLandmarks().length > 0 && snapshot.activeClip !== "Loading..." && snapshot.clipTime > 0.2;
  },
  null,
  { timeout: 60_000 },
);

const readCalf = () =>
  page.evaluate(() => {
    const landmark = window.__flightLab.getLandmarks().find((lm) => lm.id === "r_leg_calf");
    const q = landmark?.bone?.quaternion;
    return q ? [q.x, q.y, q.z, q.w] : null;
  });

const pinProcedural = () =>
  page.evaluate(() => {
    const pin = window.__flightLab.runtime.createPinFromLandmark("r_leg_calf");
    if (!pin) return null;
    const v = pin.proceduralDeltaEulerDeg;
    return { magnitude: Math.hypot(v.x, v.y, v.z), share: pin.clipShare };
  });

const angleBetween = (a, b) => {
  const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]));
  return (2 * Math.acos(dot) * 180) / Math.PI;
};

// --- 1. Proc ON -------------------------------------------------------------
const onPin = await pinProcedural();
check(Boolean(onPin), "a pin can be taken with the procedural rig on");
check(onPin.magnitude > 0.5, `procedural delta is non-zero with Proc ON (${onPin.magnitude.toFixed(2)}°)`);
const poseOn = await readCalf();

// --- 2. click Proc ----------------------------------------------------------
const procButton = page.getByRole("button", { name: "Proc", exact: true });
check((await procButton.count()) === 1, "the Proc button is on the stage toolbar");
await procButton.click();
await page.waitForTimeout(250);

const stateOff = await page.evaluate(() => ({
  enabled: window.__flightLab.isProceduralRigEnabled(),
  badge: document.body.innerText.includes("RAW CLIP · RIG BYPASSED"),
}));
check(stateOff.enabled === false, "runtime reports the rig bypassed");
check(stateOff.badge, "the stage badge says RAW CLIP · RIG BYPASSED");

const offPin = await pinProcedural();
check(Boolean(offPin), "a pin can be taken with the procedural rig off");
check(offPin.magnitude < 0.01, `procedural delta is exactly zero with Proc OFF (${offPin.magnitude.toFixed(3)}°)`);
check(offPin.share === 1, `culpability collapses to 100% clip (share ${offPin.share})`);
const poseOff = await readCalf();

const poseDelta = poseOn && poseOff ? angleBetween(poseOn, poseOff) : 0;
check(poseDelta > 0.5, `the bone pose actually changed (${poseDelta.toFixed(2)}° between Proc ON and OFF)`);

// --- 3. keyboard shortcut ---------------------------------------------------
await page.keyboard.press("g");
await page.waitForTimeout(200);
const stateOn = await page.evaluate(() => window.__flightLab.isProceduralRigEnabled());
check(stateOn === true, "G toggles the procedural rig back on");

// --- 4. Raw vs Procedural ghost --------------------------------------------
// The strong claim is not "the ghost looks different" — two different specimens
// would also look different. It is "the ghost is the *raw* version of the same
// specimen". So: freeze the clip, turn the rig off, and require the ghost to
// agree with the primary to within a rounding error. Then turn the rig back on
// and require the same pair to disagree. One of those two numbers must be ~0.
await page.evaluate(() => window.__flightLab.runtime.setPaused(true));
await page.keyboard.press("g"); // rig ON -> OFF, so the primary is raw too
await page.waitForTimeout(250);
check(
  (await page.evaluate(() => window.__flightLab.isProceduralRigEnabled())) === false,
  "the rig can be bypassed while paused",
);
await page.getByRole("button", { name: "Raw", exact: true }).click();
await page.waitForFunction(() => Boolean(window.__flightLab.getComparisonModel()), null, { timeout: 60_000 });
await page.waitForTimeout(400);

const samplePair = () =>
  page.evaluate(() => {
    const bridge = window.__flightLab;
    const primary = bridge.getLandmarks().find((lm) => lm.id === "r_leg_calf");
    const ghostModel = bridge.getComparisonModel();
    const find = (root, name) => {
      let found = null;
      root.traverse((child) => {
        if (!found && child.isBone && child.name === name) found = child;
      });
      return found;
    };
    const ghostBone = ghostModel ? find(ghostModel, "R_Calf") : null;
    const pack = (bone) =>
      bone ? [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w] : null;
    return {
      primaryId: bridge.getSpecimen()?.id ?? null,
      ghostId: bridge.getComparisonSpecimen()?.id ?? null,
      primaryPose: pack(primary?.bone),
      ghostPose: pack(ghostBone),
    };
  });

const rawPair = await samplePair();
check(Boolean(rawPair.ghostPose), "the Raw ghost exposes its bones");
check(rawPair.ghostId !== null, `the ghost names a specimen (${rawPair.ghostId})`);
check(
  rawPair.ghostId === rawPair.primaryId,
  `the ghost is the same specimen as the primary (${rawPair.ghostId} vs ${rawPair.primaryId})`,
);

const rawDelta = rawPair.ghostPose && rawPair.primaryPose ? angleBetween(rawPair.ghostPose, rawPair.primaryPose) : 180;
check(rawDelta < 1, `with the rig off, the ghost matches the primary — the ghost is raw (${rawDelta.toFixed(3)}°)`);

await page.keyboard.press("g");
await page.waitForTimeout(300);
const rigPair = await samplePair();
const ghostDelta =
  rigPair.ghostPose && rigPair.primaryPose ? angleBetween(rigPair.ghostPose, rigPair.primaryPose) : 0;
check(ghostDelta > 0.5, `with the rig on, the same pair disagrees — the delta is visible (${ghostDelta.toFixed(2)}°)`);

console.log("\n--- summary ---");
console.log(`procedural delta  ON ${onPin.magnitude.toFixed(2)}°  OFF ${offPin.magnitude.toFixed(3)}°`);
console.log(`primary pose move ON→OFF ${poseDelta.toFixed(2)}°`);
console.log(`ghost vs primary   rig OFF ${rawDelta.toFixed(3)}°  rig ON ${ghostDelta.toFixed(2)}°`);
console.log("---------------\n");

await browser.close();
if (failures.length) {
  console.log(`FAIL: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("PASS: Proc bypasses the rig and Raw ghosts the same specimen without it");
