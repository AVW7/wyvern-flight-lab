#!/usr/bin/env node
/**
 * E1.2 probe: does `Scan` actually paint the failing bones in the viewport?
 *
 * The unit test proves the overlay module rings the right bones, follows them
 * and pulses. It cannot prove the runtime *wires* it, and it cannot see a pixel.
 * This does both against a live Flight Lab:
 *
 *   1. select a clip, click `Scan`
 *   2. read the ringed bones back through the dev bridge
 *   3. count `#ef4444` pixels in the WebGL canvas before and after the click
 *
 * A green result on a clean asset is not evidence — the shipped GLB is 18/18
 * clean, so nothing should ring. To see it fire, point the lab at an asset with
 * an injected defect (`--expect Neck1,Neck2,Head`):
 *
 *   node /tmp/inject-neck-defect.mjs public/models/wyvern-v2-rig.glb \
 *     public/models/wyvern-v2-rig.glb idle        # after backing it up
 *   node scripts/probe-pose-anomaly-rings.mjs --clip idle --expect Neck1,Neck2,Head
 *
 * Run: node scripts/probe-pose-anomaly-rings.mjs [--base http://localhost:3010]
 *        [--clip idle] [--expect Neck1,Neck2] [--shot <png>]
 */

import { chromium } from "/Users/ajadvanwyk/.workbuddy-ai/binaries/node/workspace/node_modules/playwright/index.mjs";
import fs from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

const BASE = flag("--base", "http://localhost:3010");
const CLIP = flag("--clip", "idle");
const EXPECT = (flag("--expect", "") || "").split(",").filter(Boolean);
const SHOT = flag("--shot", null);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${message}`);
  if (!ok) failures.push(message);
};

try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => Boolean(window.__flightLab), null, { timeout: 60000 });
  await page.waitForFunction(() => window.__flightLab.getLandmarks().length > 0, null, { timeout: 60000 });
  check(true, "lab booted with a loaded rig");

  const clipButton = page.locator(`button[title^="Play ${CLIP} "]`).first();
  await clipButton.click();
  await page.waitForFunction(
    (name) => window.__flightLab.runtime.getPlaybackSnapshot?.().activeClip?.toLowerCase() === name,
    CLIP.toLowerCase(),
    { timeout: 20000 },
  ).catch(() => {});
  await page.waitForTimeout(600);

  /** Red pixels in the WebGL canvas — `#ef4444` is the only red in the scene. */
  const redPixels = () =>
    page.evaluate(async () => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return -1;
      const bitmap = await createImageBitmap(canvas);
      const off = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = off.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (r > 150 && g < 110 && b < 110) count += 1;
      }
      return count;
    });

  const before = await redPixels();
  // The scene is not guaranteed to be red-free (a few lit pixels read warm);
  // the claim is that the rings add a large, countable population of them.
  check(before < 20, `negligible red before Scan (${before})`);

  await page.locator('button[title^="Scan"]').first().click();
  await page.waitForTimeout(900);

  const ringed = await page.evaluate(() => window.__flightLab.getPoseAnomalyRings());
  const after = await redPixels();
  // The log is the other half of the readout: it must name the bones it ringed.
  const logHasRingCount = await page.evaluate(() =>
    /(\d+) anomalies in .* \((\d+) bones ringed\)/.test(document.body.innerText),
  );

  console.log(`\nclip ${CLIP}: ringed bones ${JSON.stringify(ringed)}, red pixels ${before} -> ${after}`);

  if (EXPECT.length === 0) {
    check(ringed.length === 0, `a clean asset rings nothing (got ${JSON.stringify(ringed)})`);
    check(after < 20, `a clean asset paints no ring (${after} red pixels)`);
  } else {
    check(
      JSON.stringify([...ringed].sort()) === JSON.stringify([...EXPECT].sort()),
      `ringed bones are ${JSON.stringify(EXPECT)} (got ${JSON.stringify(ringed)})`,
    );
    check(after > before + 50, `rings are visible on screen (${before} -> ${after} red pixels)`);
    check(logHasRingCount, "the animation log names the ringed bone count");
  }

  // Rings belong to the clip that was scanned: switching clips must clear them.
  const other = CLIP.toLowerCase() === "walk" ? "cruise" : "walk";
  await page.locator(`button[title^="Play ${other} "]`).first().click();
  await page.waitForTimeout(700);
  const afterSwitch = await page.evaluate(() => window.__flightLab.getPoseAnomalyRings());
  check(afterSwitch.length === 0, `switching to ${other} clears the rings (got ${JSON.stringify(afterSwitch)})`);

  if (SHOT) {
    // Re-run the scan so the screenshot shows the marked state, not the cleared one.
    await page.locator(`button[title^="Play ${CLIP} "]`).first().click();
    await page.waitForTimeout(500);
    await page.locator('button[title^="Scan"]').first().click();
    await page.waitForTimeout(700);
    fs.mkdirSync(SHOT.replace(/\/[^/]+$/, ""), { recursive: true });
    await page.screenshot({ path: SHOT });
    console.log(`wrote ${SHOT}`);
  }
} finally {
  await browser.close();
}

console.log(failures.length === 0 ? "\nPASS" : `\nFAIL (${failures.length})`);
process.exit(failures.length === 0 ? 0 : 1);
