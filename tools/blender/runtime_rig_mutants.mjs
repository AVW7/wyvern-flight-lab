import { encodeGlb, readGlb } from "./runtime_rig_contract.mjs";

export function runtimeRigMutants(bytes) {
  const mutations = [
    ["duplicate skin", g => { g.skins.push(structuredClone(g.skins[0])); }],
    ["empty review scene", g => { g.scenes.push({ nodes: [] }); }],
    ["renamed bone", g => { g.nodes[g.skins[0].joints[0]].name = "WrongBone"; }],
    ["reordered joints", g => { [g.skins[0].joints[0], g.skins[0].joints[1]] = [g.skins[0].joints[1], g.skins[0].joints[0]]; }],
    ["hierarchy cycle", g => { const i = g.skins[0].joints[0]; (g.nodes[i].children ??= []).push(i); }],
    ["changed rest transform", g => { g.nodes[g.skins[0].joints[0]].scale = [2, 2, 2]; }],
    ["changed bind accessor", g => { g.accessors[g.skins[0].inverseBindMatrices].byteOffset = 64; }],
    ["wrong mesh binding", g => { g.nodes.find(n => n.mesh !== undefined).skin = 1; }],
    ["missing clip", g => { g.animations.pop(); }],
    ["duplicate channel", g => { g.animations[0].channels.push(structuredClone(g.animations[0].channels[0])); }],
    ["unbound animation target", g => { g.animations[0].channels[0].target.node = g.nodes.findIndex(n => n.mesh !== undefined); }],
    ["changed geometry", g => { const p = g.meshes[0].primitives[0]; p.attributes.POSITION = p.attributes.NORMAL; }],
    ["changed weights", g => { g.accessors[g.meshes[0].primitives[0].attributes.WEIGHTS_0].normalized = false; }],
    ["mismatched animation key count", g => { g.accessors[g.animations[0].samplers[0].output].count -= 1; }],
    ["changed animation output type", g => { g.accessors[g.animations[0].samplers[0].output].type = "VEC2"; }],
    ["changed material", g => { g.materials[0].doubleSided = !g.materials[0].doubleSided; }],
  ];
  const result = mutations.map(([name, mutate]) => {
    const { gltf, binary } = readGlb(bytes);
    mutate(gltf);
    return { name, bytes: encodeGlb(gltf, binary) };
  });
  for (const [name, value] of [["late first animation key", 0.25], ["nonfinite animation time", NaN]]) {
    const { gltf, binary } = readGlb(bytes);
    const sampler = gltf.animations[0].samplers[0];
    const input = gltf.accessors[sampler.input];
    const times = Buffer.alloc(input.count * 4);
    for (let i = 0; i < input.count; i++) times.writeFloatLE(i ? i : value, i * 4);
    const view = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset: binary.length, byteLength: times.length });
    sampler.input = gltf.accessors.length;
    gltf.accessors.push({ componentType: 5126, type: "SCALAR", count: input.count, bufferView: view });
    gltf.buffers[0].byteLength += times.length;
    result.push({ name, bytes: encodeGlb(gltf, Buffer.concat([binary, times])) });
  }
  return result;
}
