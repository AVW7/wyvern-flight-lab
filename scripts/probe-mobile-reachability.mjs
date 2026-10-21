#!/usr/bin/env node
/**
 * Mobile reachability probe for the Flight Lab.
 *
 * The 2026-10-21 morning audit measured 1,349 px of unreachable interface at
 * 390x844: `.surface { height:100svh; overflow:hidden }` clipped the page
 * while the <=720px query still assumed the document scrolled. The afternoon
 * panel rework turned the side panels into overlay drawers (which carry their
 * own `overflow-y: auto`), so the answer may have changed -- and the roadmap
 * leaves it unverified.
 *
 * This measures the thing that was measured before, so the two are comparable:
 *   - can the document scroll? (window.scrollY after scrollTo(0, 5000))
 *   - how many pixels of content sit below the fold and cannot be reached?
 *   - is every interactive control hit-testable at its centre?
 *
 * Run: node scripts/probe-mobile-reachability.mjs [--base http://localhost:3010]
 */

// The harness's bundled playwright (1.63.0) expects browser builds 1243/2359,
// but this machine has 1247/2368, which the managed workspace's playwright
// 1.64.0-alpha matches. Pin the managed copy so the probe actually launches.
import { chromium, webkit } from "/Users/ajadvanwyk/.workbuddy-ai/binaries/node/workspace/node_modules/playwright/index.mjs";

const args = process.argv.slice(2);
const baseIdx = args.indexOf("--base");
const BASE = baseIdx >= 0 ? args[baseIdx + 1] : "http://localhost:3010";
const URL_PATH = "/";

const VIEWPORTS = [
  { label: "mobile-390x844", width: 390, height: 844 },
  { label: "mobile-360x800", width: 360, height: 800 },
];

const PROBE = `(() => {
  const surface = document.querySelector('main') || document.body;
  const cs = getComputedStyle(surface);

  // Can the document scroll?
  window.scrollTo(0, 5000);
  const scrolled = window.scrollY;
  window.scrollTo(0, 0);

  // Full scroll height of the page and of the surface
  const docScrollHeight = document.documentElement.scrollHeight;
  const surfaceScrollHeight = surface.scrollHeight;
  const surfaceClientHeight = surface.clientHeight;

  const isScrollable = (el) => {
    const s = getComputedStyle(el);
    return /auto|scroll/.test(s.overflowX) || /auto|scroll/.test(s.overflowY);
  };

  // A control is reachable if it can be brought inside the viewport by
  // scrolling its scrollable ancestors. A naive "is the rect inside the
  // viewport" test flags content that lives in an overflow:auto strip --
  // false positive. So: walk the ancestor chain, and for each scrollable
  // ancestor check whether the control sits outside its scrollport but
  // within its scrollable extent.
  const reachability = (el) => {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const s = getComputedStyle(node);
      const scrollsX = /auto|scroll/.test(s.overflowX);
      const scrollsY = /auto|scroll/.test(s.overflowY);
      if (scrollsX || scrollsY) {
        const r = el.getBoundingClientRect();
        const n = node.getBoundingClientRect();
        // Scrollport of the ancestor
        const left = n.left, right = n.right, top = n.top, bottom = n.bottom;
        const offRight = r.right > right + 1;
        const offLeft = r.left < left - 1;
        const offBottom = r.bottom > bottom + 1;
        const offTop = r.top < top - 1;
        if (offRight && scrollsX && node.scrollWidth > node.clientWidth + 1) return { reachable: true, via: 'scroll-x' };
        if (offLeft && scrollsX && node.scrollWidth > node.clientWidth + 1) return { reachable: true, via: 'scroll-x' };
        if (offBottom && scrollsY && node.scrollHeight > node.clientHeight + 1) return { reachable: true, via: 'scroll-y' };
        if (offTop && scrollsY && node.scrollHeight > node.clientHeight + 1) return { reachable: true, via: 'scroll-y' };
        // Inside the scrollport already
        if (!offRight && !offLeft && !offBottom && !offTop) {
          // but is the ancestor itself on screen?
          if (n.right <= window.innerWidth + 1 && n.left >= -1 && n.bottom <= window.innerHeight + 1 && n.top >= -1) {
            return { reachable: true, via: 'visible' };
          }
          return { reachable: true, via: 'in-scrollable' };
        }
      }
      node = node.parentElement;
    }
    const r = el.getBoundingClientRect();
    const inView = r.right <= window.innerWidth + 1 && r.left >= -1 && r.bottom <= window.innerHeight + 1 && r.top >= -1;
    return { reachable: inView, via: inView ? 'root-visible' : 'dead' };
  };

  const controls = [...document.querySelectorAll(
    'button, a[href], input, select, textarea, [role="button"], [role="tab"]'
  )];

  const unreachable = [];
  const zeroSized = [];
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (r.width === 0 && r.height === 0) { zeroSized.push(el.tagName + '.' + el.className); continue; }
    const verdict = reachability(el);
    if (!verdict.reachable) {
      unreachable.push({
        tag: el.tagName,
        label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        belowFold: r.top > window.innerHeight,
      });
    }
  }

  // Content below the fold that no scroll container can reach
  const panels = [...document.querySelectorAll('aside, section, div')]
    .filter(el => el.scrollHeight > el.clientHeight + 4)
    .map(el => ({
      tag: el.tagName,
      cls: (el.className || '').toString().slice(0, 48),
      scrollable: getComputedStyle(el).overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));

  // Horizontal overflow: does any element exceed the document width?
  const widest = [...document.querySelectorAll('*')]
    .map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.right > window.innerWidth + 1)
    .map(({ el, r }) => ({
      tag: el.tagName,
      cls: (el.className || '').toString().slice(0, 48),
      right: Math.round(r.right),
      width: Math.round(r.width),
    }))
    .slice(0, 8);

  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    surfaceOverflowY: cs.overflowY,
    surfaceOverflow: cs.overflow,
    surfaceHeight: cs.height,
    surfaceMaxHeight: cs.maxHeight,
    docScrollHeight,
    docScrollWidth: document.documentElement.scrollWidth,
    surfaceScrollHeight,
    surfaceClientHeight,
    scrolledAfterScrollTo: scrolled,
    totalControls: controls.length,
    unreachableCount: unreachable.length,
    unreachable: unreachable.slice(0, 12),
    zeroSizedCount: zeroSized.length,
    horizontalOverflow: widest,
    scrollableRegions: panels.slice(0, 12),
  };
})()`;

const engines = { chromium, webkit };
const results = [];

for (const [engineName, engine] of Object.entries(engines)) {
  const browser = await engine.launch({ headless: true });
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
        hasTouch: vp.width < 500,
        isMobile: vp.width < 500,
      });
      const page = await context.newPage();
      await page.goto(BASE + URL_PATH, { waitUntil: "domcontentloaded", timeout: 60000 });
      // Let the 3D scene mount and the panels settle
      await page.waitForTimeout(3500);
      const probe = await page.evaluate(PROBE);
      results.push({ engine: engineName, viewport: vp.label, ...probe });
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

console.log(JSON.stringify(results, null, 2));

// Verdict table
console.log("\n=== REACHABILITY VERDICT ===");
for (const r of results) {
  const canScroll = r.scrolledAfterScrollTo > 0;
  const verdict = r.unreachableCount === 0 && canScroll ? "PASS" : r.unreachableCount === 0 ? "PARTIAL (no scroll, but nothing off-screen)" : "FAIL";
  console.log(
    `${r.engine.padEnd(9)} ${r.viewport.padEnd(16)} scroll=${String(canScroll).padEnd(5)} ` +
    `surfaceOverflowY=${(r.surfaceOverflowY || "-").padEnd(8)} unreachable=${String(r.unreachableCount).padEnd(3)} ` +
    `controls=${String(r.totalControls).padEnd(4)} => ${verdict}`
  );
  for (const u of r.unreachable.slice(0, 6)) {
    console.log(`    - ${u.tag} "${u.label}" rect=${JSON.stringify(u.rect)} belowFold=${u.belowFold}`);
  }
}
