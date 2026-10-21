// Shared skinning I/O for the V2 GLB weight tools.
//
// The decode/append/encode pattern was copy-pasted into every weight tool; this module owns it so
// a report and a mutation cannot disagree about how a vertex is read.
import assert from "node:assert/strict";
import { Matrix4, Quaternion, Vector3 } from "three";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

await MeshoptDecoder.ready;

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const READERS = {
  5120: "readInt8", 5121: "readUInt8", 5122: "readInt16LE",
  5123: "readUInt16LE", 5125: "readUInt32LE", 5126: "readFloatLE",
};
// glTF normalization divisors. KHR_mesh_quantization is `extensionsRequired` on this asset, so
// `WyvernBody_Rebuild`'s POSITION really is normalized SHORT and must be divided by 32767.
const NORMALIZED_MAX = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

/**
 * Divisor for an accessor's raw integer reads (1 for float or non-normalized accessors).
 *
 * `decodeAccessor().get()` deliberately returns the stored integer; this is the one place that
 * knows what a stored value means, so callers never hardcode a 255 or a 32767.
 */
export function normalizationScale(accessor) {
  if (!accessor.normalized) return 1;
  const max = NORMALIZED_MAX[accessor.componentType];
  assert.ok(max, `unsupported normalized componentType ${accessor.componentType}`);
  return max;
}

/** Decode one accessor, transparently handling `EXT_meshopt_compression`. */
export function decodeAccessor(gltf, binary, index) {
  const a = gltf.accessors[index];
  const view = gltf.bufferViews[a.bufferView];
  const ext = view.extensions?.EXT_meshopt_compression;
  let data = binary;
  let offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  if (ext) {
    data = Buffer.alloc(ext.count * ext.byteStride);
    MeshoptDecoder.decodeGltfBuffer(
      data, ext.count, ext.byteStride,
      binary.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength), ext.mode, ext.filter,
    );
    offset = a.byteOffset ?? 0;
  }
  const components = COMPONENTS[a.type];
  const size = COMPONENT_SIZE[a.componentType];
  const stride = view.byteStride ?? ext?.byteStride ?? components * size;
  const read = READERS[a.componentType];
  return {
    accessor: a,
    components,
    count: a.count,
    get: (i, c) => data[read](offset + i * stride + c * size),
  };
}

/** Append a U8 accessor (JOINTS_0 / WEIGHTS_0) to the binary chunk and return its index. */
export function createU8Appender(gltf, binary) {
  const chunks = [binary];
  let length = binary.length;
  return {
    get byteLength() { return length; },
    get chunks() { return chunks; },
    append(values, type, normalized = false) {
      const components = COMPONENTS[type];
      const count = values.length / components;
      const buf = Buffer.from(values);
      const pad = (4 - (length % 4)) % 4;
      if (pad) {
        chunks.push(Buffer.alloc(pad));
        length += pad;
      }
      gltf.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: buf.length });
      chunks.push(buf);
      length += buf.length;
      const accessor = {
        bufferView: gltf.bufferViews.length - 1,
        componentType: 5121,
        count,
        type,
        min: Array(components).fill(0),
        max: Array(components).fill(255),
      };
      // JOINTS_0 must stay non-normalized: three.js reads skinIndex raw, and a normalized
      // joints accessor turns bone indices into 0..1 floats.
      if (normalized) accessor.normalized = true;
      gltf.accessors.push(accessor);
      return gltf.accessors.length - 1;
    },
  };
}

/** Node-hierarchy bind world matrices, plus the helpers the weight edits need. */
export function createRig(gltf) {
  const parentOf = new Map();
  gltf.nodes.forEach((n, i) => (n.children ?? []).forEach(c => parentOf.set(c, i)));
  const cache = new Map();
  function worldMatrix(i) {
    if (cache.has(i)) return cache.get(i);
    const n = gltf.nodes[i];
    const local = new Matrix4();
    if (n.matrix) {
      local.fromArray(n.matrix);
    } else {
      local.compose(
        new Vector3(...(n.translation ?? [0, 0, 0])),
        new Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
        new Vector3(...(n.scale ?? [1, 1, 1])),
      );
    }
    const world = parentOf.has(i) ? worldMatrix(parentOf.get(i)).clone().multiply(local) : local;
    cache.set(i, world);
    return world;
  }
  const nodeIndexByName = new Map(gltf.nodes.map((n, i) => [n.name, i]));
  const jointIndexByName = new Map(gltf.skins[0].joints.map((nodeIdx, j) => [gltf.nodes[nodeIdx].name, j]));
  return {
    parentOf,
    worldMatrix,
    nodeIndexByName,
    jointIndexByName,
    bindWorldPos: name => new Vector3().setFromMatrixPosition(worldMatrix(nodeIndexByName.get(name))),
    jointName: j => gltf.nodes[gltf.skins[0].joints[j]]?.name,
  };
}

/**
 * The mesh-local → bind-world matrix, i.e. the space the joint heads live in.
 *
 * This asset's two meshes are authored in a unit-ish local space (body POSITION spans ±21134 raw
 * normalized-SHORT units, membrane ±1.43 float) while the skeleton is ~2188× larger; the
 * conversion is baked into the inverse bind matrices, NOT into the mesh node transform (both mesh
 * nodes are roots with an identity matrix). Comparing a vertex `POSITION` straight against
 * `bindWorldPos()` therefore compares two different spaces and silently excludes every candidate —
 * measured on C5: the scapular and thoracic passes selected 0 of 14544 body vertices.
 *
 * glTF defines `jointMatrix = inverse(meshWorld) · jointWorld · inverseBindMatrix`, so at bind pose
 * `jointWorld(j) · inverseBindMatrix(j)` is the mesh-local → world map and is identical for every
 * `j`. That invariance is asserted here rather than assumed: if it ever fails the bind pose and the
 * IBMs disagree and every spatial weight test downstream is meaningless.
 */
export function bindMeshToWorld(gltf, binary, rig = createRig(gltf)) {
  const skin = gltf.skins[0];
  const ibm = decodeAccessor(gltf, binary, skin.inverseBindMatrices);
  assert.equal(ibm.accessor.type, "MAT4");
  assert.equal(ibm.accessor.componentType, 5126, "inverseBindMatrices must be float MAT4");
  const matrixOf = j => {
    const m = new Matrix4();
    for (let c = 0; c < 16; c++) m.elements[c] = ibm.get(j, c);
    return m;
  };
  const bind = rig.worldMatrix(skin.joints[0]).clone().multiply(matrixOf(0));
  let worst = 0;
  let worstJoint = 0;
  skin.joints.forEach((nodeIdx, j) => {
    const m = rig.worldMatrix(nodeIdx).clone().multiply(matrixOf(j));
    for (let c = 0; c < 16; c++) {
      const d = Math.abs(m.elements[c] - bind.elements[c]);
      if (d > worst) { worst = d; worstJoint = j; }
    }
  });
  const scale = new Vector3().setFromMatrixScale(bind).length() / Math.sqrt(3);
  assert.ok(
    worst <= 1e-4 * Math.max(1, scale),
    `bind matrices disagree on the mesh->world map: max deviation ${worst} at joint ${worstJoint}`,
  );
  return bind;
}

/**
 * Iterate a skinned primitive, handing every vertex its raw joints/weights/position.
 *
 * Weights are U8 normalized to an exact 255 sum, so a "0.25 influence" is 64, not 0.25. The
 * iterator re-quantizes each edited vertex back to an exact 255 sum before writing, and asserts
 * that it succeeded — a silent 254 or 256 is a weight-sum defect the audit will only catch later.
 *
 * `pos` is in bind **world** space, comparable against `rig.bindWorldPos()`, and honours
 * `KHR_mesh_quantization` normalization. See `bindMeshToWorld` for why that is not optional.
 */
export function editSkinWeights(gltf, binary, nodeName, edit) {
  const node = gltf.nodes.find(n => n.name === nodeName);
  assert.ok(node, `no node named ${nodeName}`);
  const prim = gltf.meshes[node.mesh].primitives[0];
  const J = decodeAccessor(gltf, binary, prim.attributes.JOINTS_0);
  const W = decodeAccessor(gltf, binary, prim.attributes.WEIGHTS_0);
  const P = decodeAccessor(gltf, binary, prim.attributes.POSITION);
  assert.equal(J.accessor.componentType, 5121, "JOINTS_0 must be U8");
  assert.ok(W.accessor.normalized && W.accessor.componentType === 5121, "WEIGHTS_0 must be normalized U8");
  const positionScale = normalizationScale(P.accessor);
  const bind = bindMeshToWorld(gltf, binary);

  const joints = [];
  const weights = [];
  let touched = 0;
  for (let i = 0; i < J.count; i++) {
    const ji = [0, 1, 2, 3].map(c => J.get(i, c));
    const wi = [0, 1, 2, 3].map(c => W.get(i, c));
    const pos = new Vector3(P.get(i, 0) / positionScale, P.get(i, 1) / positionScale, P.get(i, 2) / positionScale)
      .applyMatrix4(bind).toArray();
    if (edit(ji, wi, pos)) touched++;
    let sum = wi.reduce((a, b) => a + b, 0);
    if (sum !== 255) {
      const order = [0, 1, 2, 3].sort((a, b) => wi[b] - wi[a]);
      let diff = 255 - sum;
      for (const slot of order) {
        if (diff === 0) break;
        const delta = Math.max(-wi[slot], Math.min(255 - wi[slot], diff));
        wi[slot] += delta;
        diff -= delta;
      }
      sum = wi.reduce((a, b) => a + b, 0);
      assert.equal(sum, 255, `vertex ${i} cannot renormalize (sum ${sum})`);
    }
    joints.push(...ji);
    weights.push(...wi);
  }
  return { prim, joints, weights, count: J.count, touched };
}

/**
 * Read-only view of one primitive's weights.
 *
 * `position` is bind **world** space and honours accessor normalization, so a distance or a
 * mirror test against `rig.bindWorldPos()` is meaningful. Pass `{ space: "local" }` only when the
 * mesh-local space itself is what is being inspected.
 */
export function readSkin(gltf, binary, nodeName, { space = "world" } = {}) {
  const node = gltf.nodes.find(n => n.name === nodeName);
  assert.ok(node, `no node named ${nodeName}`);
  const prim = gltf.meshes[node.mesh].primitives[0];
  const J = decodeAccessor(gltf, binary, prim.attributes.JOINTS_0);
  const W = decodeAccessor(gltf, binary, prim.attributes.WEIGHTS_0);
  const P = decodeAccessor(gltf, binary, prim.attributes.POSITION);
  const I = prim.indices === undefined ? null : decodeAccessor(gltf, binary, prim.indices);
  const positionScale = normalizationScale(P.accessor);
  const bind = space === "world" ? bindMeshToWorld(gltf, binary) : null;
  const vertices = [];
  for (let i = 0; i < J.count; i++) {
    const position = [P.get(i, 0) / positionScale, P.get(i, 1) / positionScale, P.get(i, 2) / positionScale];
    if (bind) {
      const world = new Vector3(...position).applyMatrix4(bind);
      position[0] = world.x; position[1] = world.y; position[2] = world.z;
    }
    vertices.push({
      joints: [0, 1, 2, 3].map(c => J.get(i, c)),
      weights: [0, 1, 2, 3].map(c => W.get(i, c)),
      position,
    });
  }
  const indices = I ? Array.from({ length: I.count }, (_, i) => I.get(i, 0)) : [];
  return { prim, vertices, indices };
}

/**
 * Write a whole primitive's weights back, quantizing to normalized U8 with an exact 255 sum.
 *
 * The largest slot absorbs the rounding residue, which is the only way to keep
 * `validateRuntimeRig`'s `maxSumError` at zero without drifting the dominant influence.
 */
export function writeSkin(gltf, binary, nodeName, vertices) {
  const node = gltf.nodes.find(n => n.name === nodeName);
  assert.ok(node, `no node named ${nodeName}`);
  const prim = gltf.meshes[node.mesh].primitives[0];
  const appender = createU8Appender(gltf, binary);
  const joints = [];
  const weights = [];
  for (const [index, vertex] of vertices.entries()) {
    let sum = 0;
    for (let slot = 0; slot < 4; slot++) sum += vertex.weights[slot];
    assert.ok(sum > 1e-6, `vertex ${index} has no weight`);
    const scaled = vertex.weights.map(w => Math.round((w / sum) * 255));
    let residue = 255 - scaled.reduce((a, b) => a + b, 0);
    const lead = scaled.indexOf(Math.max(...scaled));
    scaled[lead] += residue;
    assert.equal(scaled.reduce((a, b) => a + b, 0), 255, `vertex ${index} cannot quantize`);
    joints.push(...vertex.joints);
    weights.push(...scaled);
  }
  prim.attributes.JOINTS_0 = appender.append(joints, "VEC4", false);
  prim.attributes.WEIGHTS_0 = appender.append(weights, "VEC4", true);
  return { binary: Buffer.concat(appender.chunks, appender.byteLength), count: vertices.length };
}

/** Move `delta` (0..255) onto `targetJoint`, taking it from `fromSlots`. */
export function transfer(rig, ji, wi, targetJoint, fromSlots, delta) {
  const jointIdx = rig.jointIndexByName.get(targetJoint);
  assert.notEqual(jointIdx, undefined, `unknown joint ${targetJoint}`);
  const available = fromSlots.reduce((a, s) => a + wi[s], 0);
  if (available <= 0 || delta <= 0) return false;
  delta = Math.min(delta, available);
  let slot = ji.indexOf(jointIdx);
  if (slot === -1) {
    const zero = wi.indexOf(0);
    if (zero !== -1) {
      slot = zero;
    } else {
      let smallest = 0;
      for (let c = 1; c < 4; c++) if (wi[c] < wi[smallest]) smallest = c;
      if (fromSlots.includes(smallest) || wi[smallest] >= delta) return false;
      wi[fromSlots[0]] += wi[smallest];
      wi[smallest] = 0;
      slot = smallest;
    }
    ji[slot] = jointIdx;
  }
  let remaining = delta;
  for (const s of fromSlots) {
    const take = Math.min(wi[s], remaining);
    wi[s] -= take;
    remaining -= take;
    if (remaining === 0) break;
  }
  wi[slot] += delta - remaining;
  return remaining < delta;
}
