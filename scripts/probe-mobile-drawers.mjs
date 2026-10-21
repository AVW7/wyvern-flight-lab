#!/usr/bin/env node
/**
 * Functional mobile check: can a phone user actually *use* the Flight Lab?
 *
 * The reachability probe answers "is the element in the viewport". This asks
 * the harder question: open the drawers, then confirm the controls inside
 * them are hit-testable -- i.e. `document.elementFromPoint` at the control's
 * centre returns the control (or its descendant), not a scrim or overlay.
 *
 * A control that is in the viewport but covered by the drawer scrim is
 * present-but-unusable, which is exactly the class of bug a box-only
 * measurement misses.
 *
 * Run: node scripts/probe-mobile-drawers.mjs [--base http://localhost:3010]
 */

import { chromium, webkit } from "/Users/ajadvanwyk/.workbuddy-ai/binaries/node/workspace/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : "http://localhost:3010";

const VIEWPORTS = [
  { label: "mobile-390x844", width: 390, height: 844 },
  { label: "mobile-360x800", width: 360, height: 800 },
];

const results = [];

for (const [engineName, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        hasTouch: true,
        isMobile: true,
      });
      const page = await context.newPage();
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3500);

      // Open ONE drawer at a time -- the realistic flow. Opening both at once
      // stacks them (both are 88vw wide, so they overlap) and the top one
      // covers the other, which is a different question than "can I use it".
      const drawerResults = [];
      for (const side of ["left", "right"]) {
        // Reset: close everything
        await page.evaluate(() => {
          for (const b of document.querySelectorAll("button[data-side]")) {
            if (b.getAttribute("aria-expanded") === "true") b.click();
          }
        });
        await page.waitForTimeout(600);

        const toggle = page.locator(`button[data-side="${side}"]`).first();
        if ((await toggle.count()) === 0) continue;
        await toggle.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(800);

        const hit = await page.evaluate((targetSide) => {
          const panel = [...document.querySelectorAll("aside")].find((el) => {
            const s = getComputedStyle(el);
            if (s.visibility === "hidden" || s.display === "none") return false;
            return true;
          });
          if (!panel) return { error: "no visible panel" };
          const controls = [...panel.querySelectorAll("button, a[href], input, select")];
          let usable = 0, covered = 0, offScreen = 0;
          const coveredSamples = [];
          for (const el of controls) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) { offScreen++; continue; }
            const hitEl = document.elementFromPoint(cx, cy);
            if (hitEl && (el === hitEl || el.contains(hitEl) || hitEl.contains(el))) usable++;
            else {
              covered++;
              if (coveredSamples.length < 5) {
                coveredSamples.push({
                  label: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30),
                  coveredBy: hitEl ? hitEl.tagName + "." + (hitEl.className || "").toString().slice(0, 34) : "null",
                });
              }
            }
          }
          // Can it be scrolled to the end?
          const before = panel.scrollTop;
          panel.scrollTop = panel.scrollHeight;
          const maxScroll = panel.scrollTop;
          panel.scrollTop = before;
          return {
            side: targetSide,
            panel: (panel.className || "").toString().slice(0, 44),
            visible: getComputedStyle(panel).visibility,
            controls: controls.length,
            usable, covered, offScreen,
            coveredSamples,
            scrollHeight: panel.scrollHeight,
            clientHeight: panel.clientHeight,
            maxScroll: Math.round(maxScroll),
            overflowY: getComputedStyle(panel).overflowY,
          };
        }, side);
        drawerResults.push(hit);
      }
      results.push({ engine: engineName, viewport: vp.label, drawerResults });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

console.log("=== DRAWER HIT-TEST (phone, one drawer at a time) ===");
for (const r of results) {
  console.log(`\n${r.engine} @ ${r.viewport}`);
  for (const p of r.drawerResults) {
    if (p.error) { console.log(`  ${p.side}: ${p.error}`); continue; }
    const status = p.covered === 0 && p.usable > 0 ? "OK" : p.covered > 0 ? "COVERED" : "EMPTY";
    console.log(
      `  ${status.padEnd(8)} drawer=${String(p.side).padEnd(6)} ${p.panel.padEnd(46)} ` +
      `controls=${String(p.controls).padEnd(4)} usable=${String(p.usable).padEnd(4)} ` +
      `covered=${String(p.covered).padEnd(3)} offScreen=${String(p.offScreen).padEnd(4)} ` +
      `scroll=${String(p.maxScroll).padEnd(5)}/${p.scrollHeight}`
    );
    for (const s of p.coveredSamples) {
      console.log(`      covered: "${s.label}" <- ${s.coveredBy}`);
    }
  }
}
