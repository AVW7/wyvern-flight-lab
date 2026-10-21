import * as THREE from "three";
import {
  computeDualBoneBattenTable,
  createMembraneSurfaceSolver,
  deriveMembraneSurfaceConfig,
  evaluateBankRightHotspotEnvelope,
  type MembraneSurfaceConfig,
} from "./membraneSurface";

export type MembraneSurfaceRuntimeOptions = {
  autoDerive?: boolean;
  useDualBoneBattenBlend?: boolean;
};

export function createMembraneSurfaceRuntime(
  root: THREE.Object3D,
  options: MembraneSurfaceRuntimeOptions = {},
) {
  const autoDerive = options.autoDerive ?? true;
  const useDualBoneBattenBlend = options.useDualBoneBattenBlend ?? false;
  const updates: (() => void)[] = [];
  const cleanups: (() => void)[] = [];

  root.traverse((child) => {
    const mesh = child as THREE.SkinnedMesh;
    let config = child.userData.membraneSurfaceRepair as MembraneSurfaceConfig | false | undefined;
    if (config === false) return;

    if (!config && autoDerive && mesh.isSkinnedMesh && child.name === "WyvernMembrane_ExportSafe") {
      const posAttr = mesh.geometry.getAttribute("position");
      const idxAttr = mesh.geometry.index;
      if (posAttr && idxAttr) {
        config = deriveMembraneSurfaceConfig(
          posAttr.array as ArrayLike<number>,
          idxAttr.array as ArrayLike<number>,
        );
        child.userData.membraneSurfaceRepair = config;
      }
    }
    if (!config) return;

    if (!mesh.isSkinnedMesh || mesh.geometry.attributes.position?.count !== config.sourceVertexCount) {
      throw new Error("Surface repair requires its original skinned membrane");
    }

    const solver = createMembraneSurfaceSolver(config);
    const originalGeometry = mesh.geometry;
    const geometry = originalGeometry.clone();
    mesh.geometry = geometry;

    const index = geometry.index;
    if (!index) throw new Error("Membrane surface needs indexed triangles");

    const count = config.strength.length;
    const normals = new Float32Array(config.sourceVertexCount * 3);
    const joinedNormals = new Float64Array(count * 3);
    const positionAttribute = new THREE.BufferAttribute(solver.output, 3).setUsage(THREE.DynamicDrawUsage);
    const normalAttribute = new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("membraneSurfacePosition", positionAttribute);
    geometry.setAttribute("membraneSurfaceNormal", normalAttribute);

    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const skinIdxAttr = geometry.getAttribute("skinIndex") as THREE.BufferAttribute | undefined;
    const skinWgtAttr = geometry.getAttribute("skinWeight") as THREE.BufferAttribute | undefined;
    const canFastSkin = Boolean(skinIdxAttr && skinWgtAttr && mesh.skeleton);

    const repRestPos = new Float32Array(count * 3);
    const repSkinIdx = new Uint16Array(count * 4);
    const repSkinWgt = new Float32Array(count * 4);
    let battenPairIndices: Uint16Array<ArrayBufferLike> = new Uint16Array(0);
    let battenPairWeights: Float32Array<ArrayBufferLike> = new Float32Array(0);

    if (canFastSkin && skinIdxAttr && skinWgtAttr) {
      for (let v = 0; v < count; v++) {
        const s = solver.representatives[v]!;
        repRestPos[v * 3] = posAttr.getX(s);
        repRestPos[v * 3 + 1] = posAttr.getY(s);
        repRestPos[v * 3 + 2] = posAttr.getZ(s);
        for (let k = 0; k < 4; k++) {
          repSkinIdx[v * 4 + k] = skinIdxAttr.getComponent(s, k);
          repSkinWgt[v * 4 + k] = skinWgtAttr.getComponent(s, k);
        }
      }
      const dualTable = computeDualBoneBattenTable(
        skinIdxAttr.array as ArrayLike<number>,
        skinWgtAttr.array as ArrayLike<number>,
        solver.representatives,
      );
      battenPairIndices = dualTable.pairIndices;
      battenPairWeights = dualTable.pairWeights;
      child.userData.membraneBattenPairTable = dualTable;
    }

    const joinedFaces3 = new Uint32Array(index.count);
    for (let i = 0; i < index.count; i++) {
      joinedFaces3[i] = config.vertexMap[index.getX(i)]! * 3;
    }
    const vertexMap3 = Uint32Array.from(config.vertexMap, (j) => j * 3);

    const originalMaterials = mesh.material;
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => m.clone());
    mesh.material = Array.isArray(originalMaterials) ? materials : materials[0]!;
    const oldDepth = mesh.customDepthMaterial;
    const oldDistance = mesh.customDistanceMaterial;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    const distance = new THREE.MeshDistanceMaterial();
    mesh.customDepthMaterial = depth;
    mesh.customDistanceMaterial = distance;

    const replacements = new WeakMap<THREE.Material, THREE.Material>();
    const patched = new WeakSet<THREE.Material>();
    const patchMaterial = (material: THREE.Material) => {
      patched.add(material);
      const previous = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        previous.call(material, shader, renderer);
        if (!shader.vertexShader.includes("#include <skinning_vertex>")) {
          throw new Error("Missing surface repair shader seam");
        }
        shader.vertexShader =
          "attribute vec3 membraneSurfacePosition;\nattribute vec3 membraneSurfaceNormal;\n" +
          shader.vertexShader
            .replace("#include <skinning_vertex>", "transformed = membraneSurfacePosition;")
            .replace("#include <skinnormal_vertex>", "objectNormal = membraneSurfaceNormal;");
      };
      material.customProgramCacheKey = () => "flight-lab-membrane-surface-v1";
      material.needsUpdate = true;
    };
    [...materials, depth, distance].forEach(patchMaterial);

    const getOriginalVertex = mesh.getVertexPosition;
    const point = new THREE.Vector3();
    const fallbackPositions = new Float32Array(config.sourceVertexCount * 3);
    let previousBones = new Float32Array(0);
    let previousExtraHotspotIterations = 0;
    let compositeBoneMatrices = new Float32Array(0);
    const tmpBoneMat = new THREE.Matrix4();
    const tmpComposite = new THREE.Matrix4();
    let ready = false;

    mesh.getVertexPosition = (idx, target) =>
      ready ? target.fromArray(solver.output, idx * 3) : getOriginalVertex.call(mesh, idx, target);

    updates.push(() => {
      const repairMaterial = (material: THREE.Material) => {
        if (patched.has(material)) return material;
        let replacement = replacements.get(material);
        if (!replacement) {
          replacement = material.clone();
          patchMaterial(replacement);
          replacements.set(material, replacement);
          materials.push(replacement);
        }
        return replacement;
      };
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map(repairMaterial)
        : repairMaterial(mesh.material);

      mesh.skeleton.update();
      const bones = mesh.skeleton.boneMatrices;
      if (!bones) throw new Error("Missing membrane bone matrices");
      if (previousBones.length !== bones.length) {
        previousBones = new Float32Array(bones.length).fill(NaN);
        compositeBoneMatrices = new Float32Array(bones.length);
      }

      const hotspotFrame = Number(child.userData.bankRightHotspotFrame ?? root.userData?.bankRightHotspotFrame ?? NaN);
      const hotspotEnvelope = evaluateBankRightHotspotEnvelope(hotspotFrame);
      const hotspotTotal =
        hotspotEnvelope[0]! + hotspotEnvelope[1]! + hotspotEnvelope[2]! + hotspotEnvelope[3]!;
      const extraHotspotIterations = hotspotTotal > 0 ? Math.round(hotspotTotal * 6) : 0;

      if (
        ready &&
        extraHotspotIterations === previousExtraHotspotIterations &&
        bones.every((value, i) => value === previousBones[i])
      )
        return;
      previousBones.set(bones);
      previousExtraHotspotIterations = extraHotspotIterations;

      if (canFastSkin) {
        const boneCount = bones.length / 16;
        const bindMat = mesh.bindMatrix;
        const bindMatInv = mesh.bindMatrixInverse;
        for (let b = 0; b < boneCount; b++) {
          tmpBoneMat.fromArray(bones, b * 16);
          tmpComposite.multiplyMatrices(bindMatInv, tmpBoneMat).multiply(bindMat);
          tmpComposite.toArray(compositeBoneMatrices, b * 16);
        }

        const repIn = solver.representativeInput;
        const useDualPair = useDualBoneBattenBlend || Boolean(child.userData.useDualBoneBattenBlend);

        if (useDualPair && battenPairIndices.length === count * 2) {
          for (let v = 0; v < count; v++) {
            const v3 = v * 3;
            const v2 = v * 2;
            const rx = repRestPos[v3]!;
            const ry = repRestPos[v3 + 1]!;
            const rz = repRestPos[v3 + 2]!;
            const m0 = battenPairIndices[v2]! * 16;
            const m1 = battenPairIndices[v2 + 1]! * 16;
            const w0 = battenPairWeights[v2]!;
            const w1 = battenPairWeights[v2 + 1]!;
            const sx =
              (compositeBoneMatrices[m0]! * rx +
                compositeBoneMatrices[m0 + 4]! * ry +
                compositeBoneMatrices[m0 + 8]! * rz +
                compositeBoneMatrices[m0 + 12]!) *
                w0 +
              (compositeBoneMatrices[m1]! * rx +
                compositeBoneMatrices[m1 + 4]! * ry +
                compositeBoneMatrices[m1 + 8]! * rz +
                compositeBoneMatrices[m1 + 12]!) *
                w1;
            const sy =
              (compositeBoneMatrices[m0 + 1]! * rx +
                compositeBoneMatrices[m0 + 5]! * ry +
                compositeBoneMatrices[m0 + 9]! * rz +
                compositeBoneMatrices[m0 + 13]!) *
                w0 +
              (compositeBoneMatrices[m1 + 1]! * rx +
                compositeBoneMatrices[m1 + 5]! * ry +
                compositeBoneMatrices[m1 + 9]! * rz +
                compositeBoneMatrices[m1 + 13]!) *
                w1;
            const sz =
              (compositeBoneMatrices[m0 + 2]! * rx +
                compositeBoneMatrices[m0 + 6]! * ry +
                compositeBoneMatrices[m0 + 10]! * rz +
                compositeBoneMatrices[m0 + 14]!) *
                w0 +
              (compositeBoneMatrices[m1 + 2]! * rx +
                compositeBoneMatrices[m1 + 6]! * ry +
                compositeBoneMatrices[m1 + 10]! * rz +
                compositeBoneMatrices[m1 + 14]!) *
                w1;
            repIn[v3] = Math.fround(sx);
            repIn[v3 + 1] = Math.fround(sy);
            repIn[v3 + 2] = Math.fround(sz);
          }
        } else {
          for (let v = 0; v < count; v++) {
            const v3 = v * 3;
            const v4 = v * 4;
            const rx = repRestPos[v3]!;
            const ry = repRestPos[v3 + 1]!;
            const rz = repRestPos[v3 + 2]!;
            let sx = 0;
            let sy = 0;
            let sz = 0;
            for (let k = 0; k < 4; k++) {
              const w = repSkinWgt[v4 + k]!;
              if (w === 0) continue;
              const mOff = repSkinIdx[v4 + k]! * 16;
              sx +=
                (compositeBoneMatrices[mOff]! * rx +
                  compositeBoneMatrices[mOff + 4]! * ry +
                  compositeBoneMatrices[mOff + 8]! * rz +
                  compositeBoneMatrices[mOff + 12]!) *
                w;
              sy +=
                (compositeBoneMatrices[mOff + 1]! * rx +
                  compositeBoneMatrices[mOff + 5]! * ry +
                  compositeBoneMatrices[mOff + 9]! * rz +
                  compositeBoneMatrices[mOff + 13]!) *
                w;
              sz +=
                (compositeBoneMatrices[mOff + 2]! * rx +
                  compositeBoneMatrices[mOff + 6]! * ry +
                  compositeBoneMatrices[mOff + 10]! * rz +
                  compositeBoneMatrices[mOff + 14]!) *
                w;
            }
            repIn[v3] = Math.fround(sx);
            repIn[v3 + 1] = Math.fround(sy);
            repIn[v3 + 2] = Math.fround(sz);
          }
        }
        solver.updateRepresentatives(extraHotspotIterations);
      } else {
        for (let i = 0; i < config.sourceVertexCount; i++) {
          getOriginalVertex.call(mesh, i, point).toArray(fallbackPositions, i * 3);
        }
        solver.update(fallbackPositions);
      }

      const joinedPos = solver.joinedOutput;
      joinedNormals.fill(0);
      for (let f = 0; f < joinedFaces3.length; f += 3) {
        const a3 = joinedFaces3[f]!;
        const b3 = joinedFaces3[f + 1]!;
        const c3 = joinedFaces3[f + 2]!;
        const ax = joinedPos[b3]! - joinedPos[a3]!;
        const ay = joinedPos[b3 + 1]! - joinedPos[a3 + 1]!;
        const az = joinedPos[b3 + 2]! - joinedPos[a3 + 2]!;
        const bx = joinedPos[c3]! - joinedPos[a3]!;
        const by = joinedPos[c3 + 1]! - joinedPos[a3 + 1]!;
        const bz = joinedPos[c3 + 2]! - joinedPos[a3 + 2]!;
        const nx = ay * bz - az * by;
        const ny = az * bx - ax * bz;
        const nz = ax * by - ay * bx;
        joinedNormals[a3] = joinedNormals[a3]! + nx;
        joinedNormals[a3 + 1] = joinedNormals[a3 + 1]! + ny;
        joinedNormals[a3 + 2] = joinedNormals[a3 + 2]! + nz;
        joinedNormals[b3] = joinedNormals[b3]! + nx;
        joinedNormals[b3 + 1] = joinedNormals[b3 + 1]! + ny;
        joinedNormals[b3 + 2] = joinedNormals[b3 + 2]! + nz;
        joinedNormals[c3] = joinedNormals[c3]! + nx;
        joinedNormals[c3 + 1] = joinedNormals[c3 + 1]! + ny;
        joinedNormals[c3 + 2] = joinedNormals[c3 + 2]! + nz;
      }

      for (let k = 0; k < count * 3; k += 3) {
        const length = Math.hypot(joinedNormals[k]!, joinedNormals[k + 1]!, joinedNormals[k + 2]!);
        if (length === 0) throw new Error("Undefined repaired membrane normal");
        const inv = 1 / length;
        joinedNormals[k] = joinedNormals[k]! * inv;
        joinedNormals[k + 1] = joinedNormals[k + 1]! * inv;
        joinedNormals[k + 2] = joinedNormals[k + 2]! * inv;
      }

      for (let v = 0; v < config.sourceVertexCount; v++) {
        const k = vertexMap3[v]!;
        const i = v * 3;
        normals[i] = joinedNormals[k]!;
        normals[i + 1] = joinedNormals[k + 1]!;
        normals[i + 2] = joinedNormals[k + 2]!;
      }

      ready = true;
      positionAttribute.needsUpdate = true;
      normalAttribute.needsUpdate = true;
    });

    cleanups.push(() => {
      mesh.getVertexPosition = getOriginalVertex;
      mesh.geometry = originalGeometry;
      mesh.material = originalMaterials;
      if (mesh.userData.__origMaterial) mesh.userData.__origMaterial = originalMaterials;
      mesh.customDepthMaterial = oldDepth;
      mesh.customDistanceMaterial = oldDistance;
      geometry.dispose();
      [...materials, depth, distance].forEach((m) => m.dispose());
    });
  });

  return {
    update() {
      if (updates.length) {
        root.parent?.updateWorldMatrix(true, false);
        root.updateMatrixWorld(true);
        updates.forEach((update) => update());
      }
    },
    dispose() {
      cleanups.forEach((cleanup) => cleanup());
    },
    count: updates.length,
  };
}
