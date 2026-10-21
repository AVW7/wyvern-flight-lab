import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {measureCreases} from '../membrane-crease-metrics.mjs';
const [input,output,mutant]=process.argv.slice(2),data=JSON.parse(readFileSync(input));
const samples=data.samples.map(s=>({clip:s.clip,frame:s.frame,baseline:measureCreases(s.baseline.positions,s.baseline.indices),corrective:measureCreases((mutant==='uncorrected'?s.baseline:s.corrective).positions,s.corrective.indices)}));
const failures=samples.filter(s=>!(s.corrective.p95Degrees<s.baseline.p95Degrees)||s.corrective.degenerateFaces>s.baseline.degenerateFaces);
writeFileSync(output,JSON.stringify({object:data.object,scope:data.scope,criterion:'Every sampled p95 crease angle must improve against its exact original pose, without additional degenerate triangles',failures:failures.length,samples},null,2));
assert.equal(failures.length,0,'Bank correction must measurably improve every sampled pose');
console.log(`All ${samples.length} bank poses improve against their original geometry`);
