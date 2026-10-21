#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const targetGlb = process.argv[2] ?? 'public/models/wyvern-v2-rig.glb';
console.log(`[AUDIT] Auditing animation clips for ${targetGlb}...`);

const result = spawnSync('node', ['scripts/validate-wyvern-clips.mjs', targetGlb], {
  encoding: 'utf8',
});

console.log(result.stdout);
if (result.stderr) {
  console.error(result.stderr);
}

process.exit(result.status ?? 0);
