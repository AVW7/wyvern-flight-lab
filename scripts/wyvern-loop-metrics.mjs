/**
 * Angle in radians between two orientations, in [0, pi].
 *
 * Not `Quaternion.angleTo` / `2*acos(|dot|)`. glTF stores quaternions as
 * float32 and they are not exactly unit length (measured on the v2 wyvern:
 * |q|^2 = 0.99999990), so a dot-product acos reads `|q|^2 < 1` as a real
 * rotation. The visible symptom is that comparing a quaternion with *itself*
 * returned 9.16e-4 rad, which put a 9.16e-4 rad floor under every loop seam
 * and a 0.055 rad/s floor under every angular-velocity figure — the same order
 * as the seam budget's own noise floor, so a truly closed loop could never
 * report 0.
 *
 * Normalising first and then using the chord/atan2 form is exact at zero and
 * stable near it: `quatAngle(q, q) === 0` for any q, unit or not.
 */
export function quatAngle(a, b) {
  const na = Math.hypot(a.x, a.y, a.z, a.w) || 1;
  const nb = Math.hypot(b.x, b.y, b.z, b.w) || 1;
  const ax = a.x / na;
  const ay = a.y / na;
  const az = a.z / na;
  const aw = a.w / na;
  let bx = b.x / nb;
  let by = b.y / nb;
  let bz = b.z / nb;
  let bw = b.w / nb;
  // q and -q are the same orientation; pick the nearer representative.
  if (ax * bx + ay * by + az * bz + aw * bw < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  const chord = Math.hypot(ax - bx, ay - by, az - bz, aw - bw);
  const sum = Math.hypot(ax + bx, ay + by, az + bz, aw + bw);
  return 4 * Math.atan2(chord, sum);
}

export function measurePoseEndpoints(start, end) {
  if (start.length !== end.length) throw new Error('Endpoint pose sizes differ');
  const result = { rotationRad: 0, translationRigUnits: 0, rotationBone: null, translationBone: null };
  start.forEach((pose, index) => {
    if (pose.name !== end[index].name) throw new Error('Endpoint bone order differs');
    const rotation = quatAngle(pose.quaternion, end[index].quaternion);
    const translation = pose.position.distanceTo(end[index].position);
    if (rotation > result.rotationRad) {
      result.rotationRad = rotation;
      result.rotationBone = pose.name;
    }
    if (translation > result.translationRigUnits) {
      result.translationRigUnits = translation;
      result.translationBone = pose.name;
    }
  });
  return result;
}
