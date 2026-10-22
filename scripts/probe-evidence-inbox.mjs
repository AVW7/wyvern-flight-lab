#!/usr/bin/env node
/**
 * E4 probe: does `Export` actually write the evidence into the repo?
 *
 * The unit tests can prove the ticket format and the validation; only a browser
 * can prove the button, the route and the filesystem are connected. So this
 * probe clicks the real button and then reads the real files off disk.
 *
 *   1. delete the inbox files, so nothing stale can make the run pass
 *   2. pin a joint, type a note, press `Export`
 *   3. read `latest-issue.md` / `latest-capture.png` / `latest-capture.json`
 *   4. press `Save for AI` on the banner and require the document to be rewritten
 *   5. POST a bad body straight at the route and require a 400 + no change
 *
 * Run: node scripts/probe-evidence-inbox.mjs [--base http://localhost:3010]
 */

import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { chromium } from "/Users/ajadvanwyk/.workbuddy-ai/binaries/node/workspace/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = flag("--base", "http://localhost:3010");
const REPO = path.resolve(import.meta.dirname, "..");
const INBOX = path.join(REPO, "docs", "flight-lab", "inbox");
const ISSUE = path.join(INBOX, "latest-issue.md");
const CAPTURE = path.join(INBOX, "latest-capture.png");
const TELEMETRY = path.join(INBOX, "latest-capture.json");

const failures = [];
const check = (ok, message) => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${message}`);
  if (!ok) failures.push(message);
};

const exists = async (file) => {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
};

// --- 1. clean slate ---------------------------------------------------------
await rm(ISSUE, { force: true });
await rm(CAPTURE, { force: true });
await rm(TELEMETRY, { force: true });
check((await exists(ISSUE)) === 0, "the inbox starts empty");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
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
  { timeout: 90_000 },
);

// --- 2. a pin with a note, then Export --------------------------------------
const pin = await page.evaluate(() => {
  const created = window.__flightLab.runtime.createPinFromLandmark("r_leg_calf");
  if (!created) return null;
  window.__flightLab.runtime.updateActivePinNote("calf kicks out on the downstroke");
  return { bone: created.boneName, frame: created.frame };
});
check(Boolean(pin), "a pin can be taken before exporting");

await page.getByRole("button", { name: "Export", exact: true }).click();
await page.waitForFunction(
  () => document.body.innerText.includes("latest-issue.md"),
  null,
  { timeout: 30_000 },
).catch(() => {});

// Give the route a moment to flush, then read from disk — not from the DOM.
let issue = "";
for (let attempt = 0; attempt < 40; attempt += 1) {
  if ((await exists(ISSUE)) > 0) break;
  await page.waitForTimeout(250);
}
issue = await readFile(ISSUE, "utf8").catch(() => "");

// --- 3. what landed ---------------------------------------------------------
check(issue.length > 0, `latest-issue.md was written (${issue.length} B)`);
check(issue.includes("## What looks wrong"), "the ticket has a 'what looks wrong' section");
check(
  issue.includes("calf kicks out on the downstroke"),
  "the note typed in the pin banner reached the file",
);
check(/\| Frame \| #\d+ @ 24 fps \|/.test(issue), "the ticket names the frame number at 24 fps");
check(issue.includes("`R_Calf`"), "the pinned bone is named in the ticket");
check(issue.includes("Bind Delta"), "the ticket carries the clip-vs-bind split");
check(issue.includes("Procedural Delta"), "the ticket carries the procedural split");
check(/## Pose envelope scan/.test(issue), "the ticket carries the pose-envelope scan");
check(issue.includes("docs/flight-lab/inbox/latest-capture.png"), "the ticket points at the screenshot");
check(issue.includes("## How to reproduce"), "the ticket says how to reproduce the frame");

const captureBytes = await exists(CAPTURE);
check(captureBytes > 10_000, `latest-capture.png is a real screenshot (${captureBytes} B)`);
const capture = await readFile(CAPTURE).catch(() => Buffer.alloc(0));
check(
  capture.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "latest-capture.png starts with the PNG signature",
);

const telemetry = JSON.parse(await readFile(TELEMETRY, "utf8").catch(() => "null"));
check(telemetry !== null, "latest-capture.json parses");
check(telemetry?.pins?.length === 1, `the sidecar carries the pin (${telemetry?.pins?.length})`);
check(
  telemetry?.pins?.[0]?.note === "calf kicks out on the downstroke",
  "the sidecar carries the note too",
);
check(
  telemetry?.clip?.frame === Math.round(telemetry?.clip?.time * 24),
  `the sidecar frame matches the clip time (${telemetry?.clip?.frame})`,
);

// --- 4. Save for AI rewrites the same files ---------------------------------
// Guarded: if Export never wrote a ticket, this step has nothing to rewrite and
// the run should report that as one clear failure, not die on `stat`.
const issueInfo = await stat(ISSUE).catch(() => null);
const issueMtime = issueInfo?.mtimeMs ?? 0;
let saved = "";
if (!issueInfo) {
  check(false, "Save for AI skipped: Export did not write a ticket to rewrite");
} else {
  await page.waitForTimeout(30);
  await page.getByRole("button", { name: /Save for AI/i }).click();
  await page.waitForFunction(
    () => document.body.innerText.toLowerCase().includes("saved to repo"),
    null,
    { timeout: 15_000 },
  ).catch(() => {});

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const info = await stat(ISSUE).catch(() => null);
    if (info && info.mtimeMs > issueMtime) {
      saved = await readFile(ISSUE, "utf8");
      break;
    }
    await page.waitForTimeout(250);
  }
  check(saved.length > 0, "Save for AI rewrote latest-issue.md");
  check(saved.includes("**Save for AI**"), "the rewritten ticket says which button wrote it");
  check(
    (await page.getByRole("button", { name: /Saved to repo/i }).count()) === 1,
    "the button confirms it wrote to the repo",
  );
}

await page.screenshot({ path: path.join(REPO, "docs", "flight-lab", "evidence", "2026-10-22-inbox-saved.png") });

// --- 5. the route validates ------------------------------------------------
const rejection = await page.evaluate(async () => {
  const response = await fetch("/api/flight-lab/report", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ png: "not-a-data-url", markdown: "# nope", telemetry: {} }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
});
check(rejection.status === 400, `a non-PNG body is rejected (${rejection.status})`);
check(
  typeof rejection.body?.error === "string" && rejection.body.error.length > 0,
  `the rejection explains itself (${rejection.body?.error})`,
);
check(
  saved.length > 0 && (await readFile(ISSUE, "utf8").catch(() => "")).length === saved.length,
  "a rejected request leaves the ticket untouched",
);

const listing = await page.evaluate(async () => {
  const response = await fetch("/api/flight-lab/report");
  return response.json();
});
check(listing?.ok === true && listing.files?.length === 3, "GET reports the three inbox files");

console.log("\n--- summary ---");
console.log(`ticket   ${issue.length} B → ${saved.length} B`);
console.log(`capture  ${captureBytes} B`);
console.log(`pin      ${pin?.bone} frame #${pin?.frame}`);
console.log("---------------\n");

await browser.close();
if (failures.length) {
  console.log(`FAIL: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("PASS: Export writes a self-contained ticket + screenshot into the repo");
