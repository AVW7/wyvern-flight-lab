#!/usr/bin/env node
/**
 * FL-5 probe: do the mode badges tell the truth about the asset that is loaded,
 * and does a clean V2 load stay quiet?
 *
 * The unit tests prove the resolution matrix and the guard's branches. Only a
 * browser can prove the wiring: that `modeCapabilities` reaches the mode buttons,
 * that a substitution is visible without hovering, and that the shipped V2 asset
 * really does expose 92 joints through three.js (the guard is only useful if it
 * is silent on a good load).
 *
 * Run: node scripts/probe-contract-badges.mjs [--base http://localhost:3010]
 */

import path from "node:path";
import { chromium } from "/Users/ajadvanwyk/.workbuddy-ai/binaries/node/workspace/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = flag("--base", "http://localhost:3010");
const REPO = path.resolve(import.meta.dirname, "..");

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${message}`);
  if (!ok) failures.push(message);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("pageerror", (error) => console.log(`page error: ${error.message}`));

const waitForClip = (notBefore = 0) =>
  page.waitForFunction(
    (start) => {
      const bridge = window.__flightLab;
      if (!bridge) return false;
      const snapshot = bridge.runtime.getPlaybackSnapshot();
      return (
        bridge.getLandmarks().length > 0 &&
        snapshot.activeClip !== "Loading..." &&
        snapshot.activeClip !== "Error" &&
        performance.now() > start
      );
    },
    notBefore,
    { timeout: 120_000 },
  );

/** label -> badge text (null when the mode resolved exactly). */
const readBadges = () =>
  page.evaluate(() => {
    const out = {};
    for (const button of document.querySelectorAll("button")) {
      const label = button.querySelector("[class*='modeLabel']")?.textContent?.trim();
      if (!label) continue;
      const badge = button.querySelector("[class*='modeCapabilityBadge']");
      out[label.toLowerCase()] = badge ? badge.textContent.trim().toUpperCase() : null;
    }
    return out;
  });

const readState = () =>
  page.evaluate(() => ({
    issues: window.__flightLab.getContractIssues(),
    capabilities: window.__flightLab.getModeCapabilities(),
    banner: document.querySelector("[class*='contractWarning']")?.textContent ?? null,
    clip: window.__flightLab.runtime.getPlaybackSnapshot().activeClip,
  }));

// --- 1. the shipped V2 asset must be silent ---------------------------------
await page.goto(`${BASE}/flight-lab`, { waitUntil: "domcontentloaded" });
await waitForClip();
await page.waitForTimeout(600);

const v2 = await readState();
check(Array.isArray(v2.issues) && v2.issues.length === 0, `V2 raises no contract issues (${JSON.stringify(v2.issues)})`);
check(v2.banner === null, "no contract banner on a clean V2 load");
check(
  Object.values(v2.capabilities ?? {}).every((result) => result.status === "exact"),
  "every V2 mode resolved exactly",
);

const v2Badges = await readBadges();
check(Object.keys(v2Badges).length === 7, `all seven mode buttons are on screen (${Object.keys(v2Badges).length})`);
check(
  Object.values(v2Badges).every((badge) => badge === null),
  `no substitution badges on V2 (${JSON.stringify(v2Badges)})`,
);

// --- 2. the picker holds only the working set -------------------------------
// Retired 2026-10-22: the two promoted-alias candidates. The sidebar prints
// "<visible> / <total>", so this also proves the total shrank rather than the
// rows merely being filtered out.
const picker = await page.evaluate(() => {
  const sidebar = document.querySelector("[aria-label='Wyvern specimens']");
  return {
    count: sidebar?.querySelector("[class*='resultCount']")?.textContent?.trim() ?? null,
    text: sidebar?.innerText ?? "",
  };
});
check(picker.count === "2 / 2", `the specimen picker offers two specimens (${picker.count})`);
check(picker.text.includes("V2 Rig") && picker.text.includes("V1 Rig"), "it lists the V2 runtime rig and the V1 reference");
check(picker.text.includes("Candidate") === false, "no retired candidate is listed in the picker");

// --- 3. switch to V1: the badges have to appear ------------------------------
const v1Button = page.locator("button", { hasText: /V1 Rig/i }).first();
check((await v1Button.count()) === 1, "the V1 specimen is selectable");
await v1Button.click();
await page.waitForTimeout(500);
await waitForClip(performance.now());
await page.waitForTimeout(900);

const v1 = await readState();
check(v1.clip !== "Loading..." && v1.clip !== "Error", `V1 loaded (clip "${v1.clip}")`);
check(
  v1.capabilities?.cruise?.status === "alias" && v1.capabilities?.cruise?.clipName === "FlightCruise",
  `V1 cruise resolves as an alias to FlightCruise (${v1.capabilities?.cruise?.status} → ${v1.capabilities?.cruise?.clipName})`,
);

const v1Badges = await readBadges();
check(v1Badges.cruise === "ALIAS", `the Cruise button is badged ALIAS (${v1Badges.cruise})`);
check(v1Badges.boost === "ALIAS", `the Boost button is badged ALIAS (${v1Badges.boost})`);
check(v1Badges.land === "ALIAS", `the Land button is badged ALIAS (${v1Badges.land})`);
check(v1Badges.ground === null, `Ground needs no badge — V1 has an exact idle (${v1Badges.ground})`);
check(v1Badges.takeoff === null, `Takeoff needs no badge (${v1Badges.takeoff})`);
check(v1Badges["bank l"] === null, `Bank L needs no badge (${v1Badges["bank l"]})`);

// --- 3. the badge has to match what actually plays ---------------------------
const cruiseButton = page.locator("button", { hasText: /^3\s*Cruise/i }).first();
await cruiseButton.click({ force: true }).catch(async () => {
  // The label span carries the text; fall back to the badge's own button.
  await page.locator("button", { has: page.locator("[class*='modeCapabilityBadge']"), hasText: /Cruise/i }).first().click();
});
await page.waitForTimeout(700);
const afterCruise = await page.evaluate(() => window.__flightLab.runtime.getPlaybackSnapshot().activeClip);
check(
  afterCruise.toLowerCase() === "flightcruise",
  `clicking Cruise on V1 really plays the alias it advertises (${afterCruise})`,
);

await page.screenshot({ path: path.join(REPO, "docs", "flight-lab", "evidence", "2026-10-22-v1-mode-badges.png") });

console.log("\n--- summary ---");
console.log(`V2 issues   ${JSON.stringify(v2.issues)}`);
console.log(`V1 badges   ${JSON.stringify(v1Badges)}`);
console.log(`V1 cruise   ${v1.capabilities?.cruise?.status} → ${v1.capabilities?.cruise?.clipName}`);
console.log("---------------\n");

await browser.close();
if (failures.length) {
  console.log(`FAIL: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("PASS: mode badges name the substitution, and a clean V2 load stays quiet");
