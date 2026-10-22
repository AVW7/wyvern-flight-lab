import * as THREE from "three";
import { findFlightLabSpecimen, isV2RigSpecimen, type FlightLabSpecimen } from "./catalog";
import { resolveFlightLabClip } from "./clipResolver";
import { applyGhostMaterial, computeMeshMetrics } from "./diagnostics";
import { createMembraneSurfaceRuntime } from "./membraneSurfaceRuntime";
import { resolvePhasePreservingCrossfadeTime } from "./playback";
import { createWyvernFlightRig, type FlightKinematics, type WyvernFlightRig } from "./rig/wyvernFlightRig";
import { loadModelFile } from "../scene/modelLoader";
import { cloneMaterials, normalizedClone } from "../scene/modelProcessor";
import type { FlightLabComparisonMode, FlightLabEvents, FlightLabMode } from "./types";

export interface ComparisonRigManager {
  loadComparisonRig(
    targetId: string,
    modeType: FlightLabComparisonMode,
    primarySpecimen: FlightLabSpecimen | null,
    primaryModel: THREE.Object3D | null,
    primaryActionsCount: number,
    mode: FlightLabMode,
    effectiveRate: number
  ): Promise<void>;
  clearComparisonModel(): void;
  syncFrame(
    primaryModel: THREE.Object3D | null,
    primaryActiveAction: THREE.AnimationAction | null,
    kinematics?: FlightKinematics | null,
    dt?: number
  ): void;
  syncAction(mode: FlightLabMode, effectiveRate: number, explicitClipName?: string): void;
  getComparisonModel(): THREE.Object3D | null;
  getComparisonSpecimen(): FlightLabSpecimen | null;
  getComparisonMode(): FlightLabComparisonMode;
  setComparisonMode(mode: FlightLabComparisonMode): void;
  dispose(): void;
}

function countBones(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if ((child as THREE.Bone).isBone) count++;
  });
  return count;
}

export function createComparisonRigManager(
  world: THREE.Group,
  events: FlightLabEvents
): ComparisonRigManager {
  let comparisonMode: FlightLabComparisonMode = "off";
  let comparisonModel: THREE.Object3D | null = null;
  let comparisonMixer: THREE.AnimationMixer | null = null;
  let comparisonFlightRig: WyvernFlightRig | null = null;
  let comparisonMembraneSurface: ReturnType<typeof createMembraneSurfaceRuntime> | null = null;
  let comparisonActions = new Map<string, THREE.AnimationAction>();
  let comparisonActiveAction: THREE.AnimationAction | null = null;
  let comparisonSpecimen: FlightLabSpecimen | null = null;
  let disposed = false;

  const clearComparisonModel = () => {
    comparisonMixer?.stopAllAction();
    comparisonMembraneSurface?.dispose();
    comparisonMembraneSurface = null;
    comparisonFlightRig?.reset();
    comparisonFlightRig = null;
    if (comparisonModel) {
      comparisonModel.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const orig = mesh.userData.__origMaterial;
        if (orig) mesh.material = orig;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((m) => m.dispose());
      });
      comparisonModel.removeFromParent();
    }
    comparisonModel = null;
    comparisonMixer = null;
    comparisonActions.clear();
    comparisonActiveAction = null;
    comparisonSpecimen = null;
    events.comparisonMetrics?.(null);
  };

  const loadComparisonRig = async (
    targetId: string,
    modeType: FlightLabComparisonMode,
    primarySpecimen: FlightLabSpecimen | null,
    primaryModel: THREE.Object3D | null,
    primaryActionsCount: number,
    mode: FlightLabMode,
    effectiveRate: number
  ): Promise<void> => {
    clearComparisonModel();
    comparisonMode = modeType;
    if (modeType === "off") return;

    const compSpec = findFlightLabSpecimen(targetId);
    comparisonSpecimen = compSpec;

    try {
      const gltf = await loadModelFile(compSpec.modelFile);
      if (!gltf || disposed) return;

      comparisonModel = normalizedClone(gltf.scene, compSpec.targetSize);
      comparisonModel.name = `FlightLabComparison:${compSpec.id}`;
      comparisonModel.rotation.y = compSpec.heading;
      cloneMaterials(comparisonModel);
      comparisonMembraneSurface = createMembraneSurfaceRuntime(comparisonModel);
      // "raw" is the only mode whose point is the *absence* of the procedural
      // rig: the ghost is the authored clip, the primary is clip + rig, so the
      // gap between them is exactly what `flightRig` / `neckSpring` add.
      comparisonFlightRig =
        modeType !== "raw" && isV2RigSpecimen(compSpec) ? createWyvernFlightRig(comparisonModel) : null;

      const compBase = comparisonModel.position.clone();
      comparisonModel.userData.basePosition = compBase;

      if (modeType === "ghost" || modeType === "raw") {
        applyGhostMaterial(comparisonModel, true);
        comparisonModel.position.copy(compBase);
      } else {
        comparisonModel.position.set(compBase.x + 6.8, compBase.y, compBase.z);
      }

      world.add(comparisonModel);

      comparisonMixer = new THREE.AnimationMixer(comparisonModel);
      comparisonActions = new Map(
        gltf.animations.map((clip, index) => {
          const name = clip.name || `Clip ${index + 1}`;
          return [name, comparisonMixer!.clipAction(clip)] as const;
        })
      );

      const compClipName = resolveFlightLabClip(mode, [...comparisonActions.keys()]);
      if (compClipName && comparisonActions.has(compClipName)) {
        comparisonActiveAction = comparisonActions.get(compClipName)!;
        comparisonActiveAction.reset().setEffectiveWeight(1).setEffectiveTimeScale(effectiveRate).play();
      }

      // Emit comparison metrics
      if (primarySpecimen && primaryModel) {
        const primMetrics = computeMeshMetrics(primaryModel);
        const compMetrics = computeMeshMetrics(comparisonModel);
        events.comparisonMetrics?.({
          primarySpecimen: {
            id: primarySpecimen.id,
            name: primarySpecimen.name,
            triangles: primMetrics.triangles,
            bonesCount: countBones(primaryModel),
            clipsCount: primaryActionsCount,
            modelFile: primarySpecimen.modelFile,
          },
          comparisonSpecimen: {
            id: compSpec.id,
            name: compSpec.name,
            triangles: compMetrics.triangles,
            bonesCount: countBones(comparisonModel),
            clipsCount: comparisonActions.size,
            modelFile: compSpec.modelFile,
          },
        });
      }

      events.animationLog?.({
        id: `${Date.now()}-compare-load`,
        timestamp: new Date().toLocaleTimeString(),
        type: "compare",
        message:
          modeType === "raw"
            ? `Raw vs Procedural engaged: ${compSpec.name} ghosted with its procedural rig bypassed`
            : modeType === "ghost"
              ? `Ghost overlay engaged: Synchronized ${compSpec.name} (${compSpec.id})`
              : `Formation flight engaged: ${primarySpecimen?.name ?? "Primary"} + ${compSpec.name} side-by-side`,
        details: `Target: ${compSpec.modelFile} · Mode: ${modeType}`,
      });
    } catch (err) {
      console.error("[FlightLab] Failed to load comparison rig:", err);
    }
  };

  const syncFrame = (
    primaryModel: THREE.Object3D | null,
    primaryActiveAction: THREE.AnimationAction | null,
    kinematics?: FlightKinematics | null,
    dt = 1 / 60
  ): void => {
    if (!comparisonModel || !primaryActiveAction || !comparisonActiveAction) return;

    const activeClipObj = primaryActiveAction.getClip();
    const compClipObj = comparisonActiveAction.getClip();
    if (activeClipObj && compClipObj && activeClipObj.duration > 0) {
      const normProgress = (primaryActiveAction.time % activeClipObj.duration) / activeClipObj.duration;
      comparisonActiveAction.time = normProgress * compClipObj.duration;
      comparisonMixer?.update(0);
    }

    if (primaryModel) {
      const primBase = (primaryModel.userData.basePosition as THREE.Vector3 | undefined) ?? new THREE.Vector3();
      const compBase = (comparisonModel.userData.basePosition as THREE.Vector3 | undefined) ?? new THREE.Vector3();

      const relX = primaryModel.position.x - primBase.x;
      const relY = primaryModel.position.y - primBase.y;
      const relZ = primaryModel.position.z - primBase.z;

      if (comparisonMode === "formation") {
        comparisonModel.position.set(compBase.x + relX + 6.8, compBase.y + relY, compBase.z + relZ);
        comparisonModel.rotation.copy(primaryModel.rotation);
      } else if (comparisonMode === "ghost" || comparisonMode === "raw") {
        comparisonModel.position.set(compBase.x + relX, compBase.y + relY, compBase.z + relZ);
        comparisonModel.rotation.copy(primaryModel.rotation);
      }
    }

    if (comparisonFlightRig && kinematics) {
      comparisonFlightRig.update(
        {
          ...kinematics,
          clipTime: comparisonActiveAction.time,
        },
        null,
        dt
      );
    }

    if (comparisonModel) {
      comparisonModel.userData.bankRightHotspotFrame =
        comparisonActiveAction.getClip().name === "bankRight"
          ? comparisonActiveAction.time * 24
          : NaN;
    }
    comparisonMembraneSurface?.update();
  };

  const syncAction = (mode: FlightLabMode, effectiveRate: number, explicitClipName?: string): void => {
    if (!comparisonMixer || comparisonActions.size === 0) return;

    let compClip: string | null = null;
    if (explicitClipName) {
      if (comparisonActions.has(explicitClipName)) {
        compClip = explicitClipName;
      } else {
        const targetLower = explicitClipName.toLowerCase();
        for (const key of comparisonActions.keys()) {
          if (key.toLowerCase() === targetLower) {
            compClip = key;
            break;
          }
        }
      }
    }
    if (!compClip) {
      compClip = resolveFlightLabClip(mode, [...comparisonActions.keys()]);
    }
    if (compClip && comparisonActions.has(compClip)) {
      const cAction = comparisonActions.get(compClip)!;
      const prevClipName = comparisonActiveAction?.getClip().name;
      const prevTime = comparisonActiveAction ? comparisonActiveAction.time : 0;
      const prevDuration = comparisonActiveAction ? comparisonActiveAction.getClip().duration : 0;
      cAction.reset().setEffectiveWeight(1).setEffectiveTimeScale(effectiveRate);
      if (comparisonActiveAction && comparisonActiveAction !== cAction) {
        cAction.time = resolvePhasePreservingCrossfadeTime(
          prevClipName,
          compClip,
          prevTime,
          prevDuration,
          cAction.getClip().duration
        );
      }
      cAction.play();
      if (comparisonActiveAction && comparisonActiveAction !== cAction) {
        cAction.crossFadeFrom(comparisonActiveAction, 0.24, true);
      }
      comparisonActiveAction = cAction;
    }
  };

  return {
    loadComparisonRig,
    clearComparisonModel,
    syncFrame,
    syncAction,
    getComparisonModel: () => comparisonModel,
    getComparisonSpecimen: () => comparisonSpecimen,
    getComparisonMode: () => comparisonMode,
    setComparisonMode: (mode: FlightLabComparisonMode) => {
      comparisonMode = mode;
    },
    dispose: () => {
      disposed = true;
      clearComparisonModel();
    },
  };
}
