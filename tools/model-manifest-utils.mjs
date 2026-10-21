import { readFileSync } from "node:fs";

export function readGlb(path) {
  const buffer = readFileSync(path);
  if (buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "glTF") {
    throw new Error(`Invalid GLB: ${path}`);
  }
  const jsonLength = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).replace(/\0+$/g, ""));
  let triangles = 0;
  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if ((primitive.mode ?? 4) !== 4) continue;
      const count =
        gltf.accessors?.[primitive.indices]?.count ??
        gltf.accessors?.[primitive.attributes?.POSITION]?.count ??
        0;
      triangles += Math.floor(count / 3);
    }
  }
  return {
    triangles,
    animations: (gltf.animations ?? []).map((animation, index) => animation.name || `animation-${index + 1}`),
    skins: gltf.skins?.length ?? 0,
    extensionsRequired: gltf.extensionsRequired ?? [],
    nodeNames: (gltf.nodes ?? []).map((node) => node.name).filter(Boolean),
  };
}
