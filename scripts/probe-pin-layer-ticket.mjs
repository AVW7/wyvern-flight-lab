#!/usr/bin/env node
/**
 * E2 probe: does a pin actually carry its layer attribution into the ticket?
 *
 * The unit test proves the maths (`q_bind⁻¹·q_mixer`, `q_mixer⁻¹·q_final`) and
 * the ticket format. It cannot prove the runtime *wires* the snapshot — that
 * `mixerPose` is captured before `flightRig.update`, that the landmark resolver
 * receives it, that the note input reaches the pin, or that the clipboard gets
 * the regenerated ticket. This does all four against a live Flight Lab:
 *
 *   1. create a pin on the head through the dev bridge (no fragile canvas click)
 *   2. read the layer split and the ticket back
 *   3. type a note into the banner input
 *   4. click `Copy for AI` and read the real clipboard
 *
 * Run: node scripts/probe-pin-layer-ticket.mjs [--base http://localhost:3010]
 */

import { chromium } from "/Users/ajadvanwyk/.workbuddy-ai/binaries/node/workspace/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = flag("--base", "http://localhost:3010");
const NOTE = flag("--note", "neck craned too high on the hold");

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${message}`);
  if (!ok) failures.push(message);
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
page.on("pageerror", (error) => console.log(`page error: ${error.message}`));

await page.goto(`${BASE}/flight-lab`, { waitUntil: "domcontentloaded" });

// Wait for the specimen, the clip *and* a live pose. Landmarks resolve before
// the clip does, so pinning on `getLandmarks().length > 0` alone captures a
// specimen whose mixer has not written a frame yet — every delta reads zero.
await page.waitForFunction(
  () => {
    const bridge = window.__flightLab;
    if (!bridge) return false;
    const snapshot = bridge.runtime.getPlaybackSnapshot();
    return (
      bridge.getLandmarks().length > 0 &&
      Boolean(snapshot.activeClip) &&
      snapshot.activeClip !== "Loading..." &&
      snapshot.clipTime > 0.2
    );
  },
  null,
  { timeout: 60_000 },
);

const created = await page.evaluate(() => {
  const bridge = window.__flightLab;
  const pin = bridge.runtime.createPinFromLandmark("head");
  return pin ? { id: pin.id, bone: pin.boneName, frame: pin.frame, clipTime: pin.clipTime } : null;
});

check(Boolean(created), "a pin can be created on the head landmark");
if (!created) {
  await browser.close();
  process.exit(1);
}

const pin = await page.evaluate(() => {
  const p = window.__flightLab.getActivePin();
  return {
    bone: p.boneName,
    frame: p.frame,
    clipTime: p.clipTime,
    clip: p.clipName,
    clipDelta: p.clipDeltaEulerDeg,
    proceduralDelta: p.proceduralDeltaEulerDeg,
    horizon: p.worldHorizonEulerDeg,
    clipShare: p.clipShare,
    snippet: p.aiSnippet,
  };
});

check(pin.frame === Math.round(pin.clipTime * 24), `frame is clipTime*24 (${pin.frame} @ ${pin.clipTime}s)`);
check(pin.clip !== "Loading...", `a real clip was playing when the pin was taken (${pin.clip})`);

// The layer split has to be *measured*, not zeroed: the pin is taken while the
// clip is playing, so the head is displaced from bind by the baked track.
const clipMagnitude = Math.hypot(pin.clipDelta.x, pin.clipDelta.y, pin.clipDelta.z);
check(clipMagnitude > 0.5, `bind delta is non-zero (${clipMagnitude.toFixed(2)}°)`);
check(pin.clipShare >= 0 && pin.clipShare <= 1, `clip share in 0..1 (${pin.clipShare})`);
check(
  Number.isFinite(pin.horizon.x) && Number.isFinite(pin.horizon.y) && Number.isFinite(pin.horizon.z),
  `world horizon resolved (${pin.horizon.x}°, ${pin.horizon.y}°, ${pin.horizon.z}°)`,
);

for (const label of ["Frame #", "Bind Delta", "Procedural Delta", "World Horizon Pitch", "Culpability", "User Feedback"]) {
  check(pin.snippet.includes(label), `ticket carries "${label}"`);
}
check(pin.snippet.includes(`Frame #${pin.frame}`), "ticket frame matches the pin");
check(/Culpability: \d+% from baked GLB track/.test(pin.snippet), "culpability names the GLB track");

// The note input is the only writable part of a pin; it must reach the ticket.
const input = page.locator('input[aria-label="Describe issue for AI"]');
check(await input.count() === 1, "the banner exposes the note input");
await input.fill(NOTE);
await page.waitForTimeout(150);

const noted = await page.evaluate(() => window.__flightLab.getActivePin());
check(noted.note === NOTE, `the note reached the pin (${JSON.stringify(noted.note)})`);
check(noted.aiSnippet.includes(`User Feedback: ${NOTE}`), "the ticket was regenerated with the note");

await page.locator('[class*="pinCopyBtn"]').first().click();
await page.waitForTimeout(150);
const clipboard = await page.evaluate(() => navigator.clipboard.readText());
check(clipboard.includes(`User Feedback: ${NOTE}`), "Copy for AI put the noted ticket on the clipboard");
check(clipboard.includes("Bind Delta"), "clipboard ticket carries the layer split");

// The split only earns its keep if the procedural half can be non-zero, so pin
// a joint the flight rig actually drives (`R_Calf`, measured at ~15°).
const rigged = await page.evaluate(() => {
  const pin = window.__flightLab.runtime.createPinFromLandmark("r_leg_calf");
  return pin
    ? {
        clip: pin.clipDeltaEulerDeg,
        procedural: pin.proceduralDeltaEulerDeg,
        share: pin.clipShare,
        snippet: pin.aiSnippet,
      }
    : null;
});
check(Boolean(rigged), "a pin can be created on the right calf");
if (rigged) {
  const magnitude = (v) => Math.hypot(v.x, v.y, v.z);
  const procedural = magnitude(rigged.procedural);
  console.log(
    `     right calf: clip ${magnitude(rigged.clip).toFixed(2)}° · procedural ${procedural.toFixed(2)}° · share ${rigged.share}`,
  );
  check(procedural > 0.5, `the pin records a non-zero procedural delta (${procedural.toFixed(2)}°)`);
  check(rigged.share < 1, `culpability is split, not 100/0 (${rigged.share})`);
  check(/Culpability: \d+% from baked GLB track.*\d+% from `wyvernFlightRig`/.test(rigged.snippet), "the ticket names both layers");
}

// Dump Rig must reach the clipboard, not just the devtools console.
const dump = page.getByRole("button", { name: /Dump Rig|Copied Rig Report/ });
check((await dump.count()) === 1, "the Dump Rig button is present");
if ((await dump.count()) === 1) {
  await dump.click();
  await page.waitForTimeout(250);
  const report = await page.evaluate(() => navigator.clipboard.readText());
  check(report.includes("WYVERN FLIGHT LAB DIAGNOSTIC REPORT"), "Dump Rig put the report on the clipboard");
  check(report.includes("ACTIVE INSPECTION PINS"), "the copied report carries the pins");
  // The button label is uppercased by CSS, so compare case-insensitively.
  const label = await dump.innerText();
  check(
    label.toUpperCase().includes("COPIED RIG REPORT"),
    `the button confirms the copy (label: ${JSON.stringify(label)})`,
  );
}

// Is the procedural layer ever non-zero on this rig? If every joint reads 0,
// either the flight rig is not writing or the snapshot boundary is wrong.
const layerScan = await page.evaluate(() => {
  const landmarks = window.__flightLab.getLandmarks();
  let maxProcedural = 0;
  let worstBone = null;
  for (const landmark of landmarks) {
    const a = landmark.mixerQuaternion;
    const b = landmark.bone.quaternion;
    const dot = Math.min(1, Math.abs(a.dot(b)));
    const degrees = (2 * Math.acos(dot) * 180) / Math.PI;
    if (degrees > maxProcedural) {
      maxProcedural = degrees;
      worstBone = landmark.boneName;
    }
  }
  return { count: landmarks.length, maxProcedural, worstBone };
});
console.log(
  `     widest mixer→final gap across ${layerScan.count} landmarks: ${layerScan.maxProcedural.toFixed(2)}° (${layerScan.worstBone})`,
);
check(
  layerScan.maxProcedural > 0.5,
  `the procedural layer writes something (${layerScan.maxProcedural.toFixed(2)}° on ${layerScan.worstBone})`,
);

console.log("\n--- clipboard ---");
console.log(clipboard);
console.log("-----------------\n");

await browser.close();
if (failures.length) {
  console.log(`FAIL: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("PASS: pin layer attribution reaches the clipboard ticket");
