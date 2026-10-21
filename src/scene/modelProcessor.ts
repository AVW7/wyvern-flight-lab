import * as THREE from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

const tempBoundsVec = new THREE.Vector3();
const tempBoundsCenter = new THREE.Vector3();
const tempBoundsSize = new THREE.Vector3();
const tempSkinMat = new THREE.Matrix4();

export function measureBounds(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const box = new THREE.Box3();

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    const skinnedMesh = child as THREE.SkinnedMesh;
    if (
      skinnedMesh.isSkinnedMesh &&
      skinnedMesh.skeleton &&
      mesh.geometry.attributes.position &&
      mesh.geometry.attributes.skinIndex &&
      mesh.geometry.attributes.skinWeight
    ) {
      const posAttr = mesh.geometry.attributes.position;
      const skinIndex = mesh.geometry.attributes.skinIndex;
      const skinWeight = mesh.geometry.attributes.skinWeight;
      const bindMatrix = skinnedMesh.bindMatrix;
      const bones = skinnedMesh.skeleton.bones;
      const boneInverses = skinnedMesh.skeleton.boneInverses || [];

      const count = posAttr.count;
      const step = count > 1200 ? Math.ceil(count / 1200) : 1;
      for (let i = 0; i < count; i += step) {
        tempBoundsVec.fromBufferAttribute(posAttr, i);
        tempBoundsVec.applyMatrix4(bindMatrix);

        const x = tempBoundsVec.x,
          y = tempBoundsVec.y,
          z = tempBoundsVec.z;
        let vx = 0,
          vy = 0,
          vz = 0;

        for (let j = 0; j < 4; j += 1) {
          const weight = skinWeight.getComponent(i, j);
          if (weight === 0) continue;
          const bIndex = skinIndex.getComponent(i, j);
          const bone = bones[bIndex];
          if (!bone) continue;

          const boneInv = boneInverses[bIndex] || skinnedMesh.bindMatrixInverse;
          tempSkinMat.multiplyMatrices(bone.matrixWorld, boneInv);

          const e = tempSkinMat.elements;
          vx += (e[0] * x + e[4] * y + e[8] * z + e[12]) * weight;
          vy += (e[1] * x + e[5] * y + e[9] * z + e[13]) * weight;
          vz += (e[2] * x + e[6] * y + e[10] * z + e[14]) * weight;
        }
        bounds.expandByPoint(tempBoundsVec.set(vx, vy, vz));
      }
    } else {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      if (mesh.geometry.boundingBox) {
        box.copy(mesh.geometry.boundingBox);
        bounds.union(box.applyMatrix4(mesh.matrixWorld));
      }
    }
  });

  return bounds;
}

export function normalizedClone(
  scene: THREE.Group,
  targetScale: number,
  excludedNodeNames: string[] = []
): THREE.Object3D {
  const instance = cloneSkeleton(scene);
  const excluded = new Set(excludedNodeNames);
  const removals: THREE.Object3D[] = [];

  instance.traverse((child) => {
    if (excluded.has(child.name) || (child as THREE.Camera).isCamera || (child as THREE.Light).isLight) {
      removals.push(child);
    }
  });

  for (const child of removals) child.removeFromParent();

  const bounds = measureBounds(instance);
  const size = bounds.getSize(tempBoundsSize);
  const largest = Math.max(size.x, size.y, size.z, 0.0001);
  const scaleFactor = targetScale / largest;
  instance.scale.multiplyScalar(scaleFactor);

  const center = bounds.getCenter(tempBoundsCenter).multiplyScalar(scaleFactor);
  instance.position.x -= center.x;
  instance.position.z -= center.z;
  instance.position.y -= bounds.min.y * scaleFactor;

  return instance;
}

export function cloneMaterials(
  root: THREE.Object3D,
  tint?: string | null
): void {
  const tintColor = tint ? new THREE.Color(tint) : null;

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.userData.sharedGeometry = true;
    if ((mesh as any).isSkinnedMesh) mesh.frustumCulled = false;

    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => m.clone())
      : mesh.material?.clone();

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of materials) {
      const standardMat = mat as THREE.MeshStandardMaterial;
      if (standardMat && (mesh as any).isSkinnedMesh) {
        standardMat.side = THREE.DoubleSide;
        standardMat.shadowSide = THREE.DoubleSide;
      }
      if (tintColor && standardMat?.color) standardMat.color.lerp(tintColor, 0.28);
    }
  });
}

export function configureShadows(root: THREE.Object3D, _mode?: string): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
}
