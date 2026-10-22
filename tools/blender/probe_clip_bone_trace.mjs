// Per-frame inspection of one clip's fastest bone: is it a lunge or a buzz?
// A smooth lunge gives a few large same-direction steps; a buzz alternates sign.
import { AnimationMixer, LoopRepeat, Quaternion, Vector3 } from "three";
import { loadRig } from "../../scripts/wyvern-dynamics.mjs";

const [, , path, clipName, boneName] = process.argv;
const rig = await loadRig(path);
const clip = rig.gltf.animations.find((a) => a.name === clipName);
if (!clip) throw new Error(`no clip ${clipName}`);
const bone = rig.scene.getObjectByName(boneName);
if (!bone) throw new Error(`no bone ${boneName}`);

const HZ = 60;
const dt = 1 / HZ;
const frames = Math.max(2, Math.round(clip.duration / dt) + 1);
const mixer = new AnimationMixer(rig.scene);
const action = mixer.clipAction(clip);
action.setLoop(LoopRepeat, Infinity);

const cur = new Quaternion();
const prev = new Quaternion();
const rel = new Quaternion();
const axis = new Vector3();
const DEG = 180 / Math.PI;
const steps = [];
let previousSign = 0;
let reversals = 0;
let total = 0;

for (let f = 0; f < frames; f++) {
  action.reset().play();
  action.time = Math.min(clip.duration, f * dt);
  mixer.update(0);
  rig.scene.updateMatrixWorld(true);
  bone.getWorldQuaternion(cur);
  if (f === 0) { prev.copy(cur); continue; }

  rel.copy(prev).invert().multiply(cur);
  const angle = 2 * Math.atan2(Math.hypot(rel.x, rel.y, rel.z), Math.min(1, Math.abs(rel.w))) * DEG;
  const sign = Math.sign(rel.w) || 1;
  rel.normalize();
  axis.set(rel.x, rel.y, rel.z).normalize();
  // Project the step onto the dominant world axis to get a signed sense of direction.
  const dominant = ["x", "y", "z"].reduce((a, b) => (Math.abs(axis[a]) >= Math.abs(axis[b]) ? a : b));
  const signed = angle * Math.sign(axis[dominant]) * sign;
  steps.push({ angle, signed, dominant });
  total += angle;
  if (previousSign !== 0 && Math.sign(signed) !== previousSign) reversals += 1;
  previousSign = Math.sign(signed);
  prev.copy(cur);
}
mixer.stopAllAction();

console.log(`${path} · ${clipName} · ${boneName}`);
console.log(`duration ${clip.duration.toFixed(3)}s · ${frames} samples at ${HZ}Hz · total travel ${total.toFixed(1)}deg · ${reversals} direction reversals\n`);
console.log("frame   step(deg)  signed    axis");
for (let i = 0; i < steps.length; i++) {
  const s = steps[i];
  console.log(`${String(i + 1).padStart(5)}  ${s.angle.toFixed(2).padStart(9)}  ${s.signed.toFixed(2).padStart(7)}    ${s.dominant}`);
}
const angles = steps.map((s) => s.angle);
console.log(`\nstep: min ${Math.min(...angles).toFixed(2)}  median ${[...angles].sort((a, b) => a - b)[Math.floor(angles.length / 2)].toFixed(2)}  max ${Math.max(...angles).toFixed(2)}`);
