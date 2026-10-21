import * as THREE from "three";
import { releaseWebGLRenderer } from "../sanctuary-studio/webglContext";
import { loadModelFile } from "../scene/modelLoader";
import { cloneMaterials, configureShadows, normalizedClone } from "../scene/modelProcessor";
import { createFlightLabCamera } from "./camera";
import { createWyvernFlightRig, type FlightKinematics, type WyvernFlightRig } from "./rig/wyvernFlightRig";
import { createInteractiveFlightController, type FlightInputState } from "./interactiveFlight";
import { isV2RigSpecimen, type FlightLabSpecimen } from "./catalog";
import { resolveFlightLabClip, resolveOneShotCapability } from "./clipResolver";
import {
  applyWireframe,
  computeMeshMetrics,
  createSilhouetteDiagnostics,
  createSkeletonDiagnostics,
  createVortexTrails,
} from "./diagnostics";
import {
  computeCenterOfMassAnchor,
  detectStrokePhase,
  measureBilateralSymmetry,
  resolveAnatomicalLandmarks,
  type BilateralSymmetryMetrics,
  type FlightLabStrokePhase,
  type ResolvedLandmark,
} from "./anatomicalMap";
import { createFlightLabEnvironment } from "./environment";
import {
  calculateClipTelemetry,
  calculateEffectiveRate,
  calculateFrameStepTime,
  canSpecimenExecuteMode,
  canSpecimenExecuteOneShot,
  DEFAULT_INSPECTION_FPS,
  isDeathAction,
  MAX_SPEED_SCALE,
  MIN_SPEED_SCALE,
  resolveClipFlightContext,
  resolvePhasePreservingCrossfadeTime,
  type FlightLabPlaybackSnapshot,
  type FlightLabPlaybackStatus,
} from "./playback";
import { sampleLandmarks, scanSeam, SEAM_JUMP_THRESHOLD_DEG, SEAM_THRESHOLD_PROVENANCE } from "./motionProbe";
import { createComparisonRigManager } from "./comparisonRig";
import { createFlightLabInteractionManager } from "./interactionManager";
import { exportEvidenceCapture, formatDiagnosticsReport } from "./evidenceExport";
import { createNeckSpring } from "./neckSpring";
import { createMembraneSurfaceRuntime } from "./membraneSurfaceRuntime";
import type {
  FlightLabAnimationClipInfo,
  FlightLabAnimationEvent,
  FlightLabCameraPreset,
  FlightLabCameraState,
  FlightLabComparisonMetrics,
  FlightLabComparisonMode,
  FlightLabEvents,
  FlightLabHoverLandmark,
  FlightLabMeshMetrics,
  FlightLabMode,
  FlightLabPin,
  FlightLabRuntime,
  FlightLabTelemetry,
  FlightLabTheme,
} from "./types";

export type {
  FlightLabAnimationClipInfo,
  FlightLabAnimationEvent,
  FlightLabCameraPreset,
  FlightLabCameraState,
  FlightLabComparisonMetrics,
  FlightLabComparisonMode,
  FlightLabEvents,
  FlightLabHoverLandmark,
  FlightLabMeshMetrics,
  FlightLabMode,
  FlightLabPin,
  FlightLabRuntime,
  FlightLabTelemetry,
  FlightLabTheme,
};
export { resolveFlightLabClip };

export function createFlightLabRuntime(container: HTMLElement, events: FlightLabEvents = {}): FlightLabRuntime {
  let themeState: FlightLabTheme = "dark";
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#080808");
  scene.fog = new THREE.FogExp2("#080808", 0.018);

  const aspect = (container.clientWidth || 900) / (container.clientHeight || 620);
  const perspectiveCamera = new THREE.PerspectiveCamera(43, aspect, 0.1, 180);
  const orthographicCamera = new THREE.OrthographicCamera(-12 * aspect, 12 * aspect, 12, -12, 0.1, 180);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.replaceChildren(renderer.domElement);

  const world = new THREE.Group();
  scene.add(world);

  // Submodules
  const environment = createFlightLabEnvironment(scene, themeState);
  const cameraController = createFlightLabCamera(container, perspectiveCamera, orthographicCamera);
  const skeletonDiagnostics = createSkeletonDiagnostics(scene, themeState);
  const silhouetteDiagnostics = createSilhouetteDiagnostics(themeState);
  const vortexTrails = createVortexTrails(scene, themeState);
  const comparisonRig = createComparisonRigManager(world, events);
  const interactiveFlight = createInteractiveFlightController();
  const neckSpring = createNeckSpring();

  // Diagnostic states
  let showSkeleton = false;
  let showWireframe = false;
  let showSilhouette = false;
  let showStreamlines = false;
  let showProbes = false;
  let isLooping = true;
  let isOneShot = false;
  let isDeath = false;
  let floorVisible = false;

  // Runtime model and playback states
  let disposed = false;
  let loadController: AbortController | null = null;
  let activeSpecimen: FlightLabSpecimen | null = null;
  let model: THREE.Object3D | null = null;
  let flightRig: WyvernFlightRig | null = null;
  let membraneSurface: ReturnType<typeof createMembraneSurfaceRuntime> | null = null;
  let mixer: THREE.AnimationMixer | null = null;
  let actions = new Map<string, THREE.AnimationAction>();
  let activeAction: THREE.AnimationAction | null = null;
  let mode: FlightLabMode = "cruise";
  let paused = false;
  let speedScale = 1;
  let currentClip = "None";
  let elapsed = 0;
  let inspectionFps = DEFAULT_INSPECTION_FPS;
  let telemetryInterval: ReturnType<typeof setInterval> | null = null;

  // Telemetry cache
  let currentLandmarks: ResolvedLandmark[] = [];
  let prevTipY: number | null = null;
  let currentStrokePhase: FlightLabStrokePhase = "glide";
  let currentSymmetry: BilateralSymmetryMetrics | null = null;
  const GROUND_ALTITUDE_Y = -5.45;
  const FLIGHT_ALTITUDE_Y = 0.0;
  let currentAltitudeY = FLIGHT_ALTITUDE_Y;
  let prevAltitudeY = currentAltitudeY;
  let dynamicVerticalSpeed = 0;
  let dynamicAirspeed = 18;
  const cameraFollowAnchor = new THREE.Vector3();

  const getEffectiveRate = () => calculateEffectiveRate(speedScale, mode);

  const getPlaybackStatus = (): FlightLabPlaybackStatus => {
    if (!activeAction) return "paused";
    if (isDeath) return "completed";
    if (!isLooping) {
      const dur = activeAction.getClip().duration;
      if (dur > 0 && activeAction.time >= dur) return "completed";
    }
    return paused ? "paused" : "playing";
  };

  const getPlaybackSnapshot = (): FlightLabPlaybackSnapshot => {
    const activeClipObj = activeAction?.getClip();
    const clipDuration = activeClipObj ? activeClipObj.duration : 0;
    const { clipTime, clipProgress } = activeAction
      ? calculateClipTelemetry(activeAction.time, clipDuration, isLooping)
      : { clipTime: 0, clipProgress: 0 };
    return {
      status: getPlaybackStatus(),
      activeClip: currentClip,
      isLooping,
      isOneShot,
      isDeath,
      clipTime,
      clipDuration: Number(clipDuration.toFixed(2)),
      clipProgress,
      speedScale,
      effectiveRate: getEffectiveRate(),
      inspectionFps,
    };
  };

  const publishTelemetry = () => {
    if (disposed) return;
    const snapshot = getPlaybackSnapshot();
    const targetRoll = mode === "bank-left" ? 0.42 : mode === "bank-right" ? -0.42 : 0;
    const landmarks = model ? sampleLandmarks(model) : undefined;

    events.playbackState?.(snapshot);

    events.telemetry?.({
      speed: interactiveFlight.isActive()
        ? Math.round(interactiveFlight.getTelemetry().airspeedMps * 3.6)
        : Math.round(dynamicAirspeed * 3.6),
      altitude: Math.max(0, Math.round((currentAltitudeY - GROUND_ALTITUDE_Y) * 10) / 10),
      bank: Math.round(THREE.MathUtils.radToDeg(targetRoll)),
      clip: currentClip,
      clipDuration: snapshot.clipDuration,
      clipTime: snapshot.clipTime,
      clipProgress: snapshot.clipProgress,
      cameraDistance: Math.round(cameraController.getDistance()),
      isPlaying: snapshot.status === "playing",
      speedScale,
      effectiveRate: snapshot.effectiveRate,
      inspectionFps,
      isOrtho: cameraController.isOrthoActive(),
      landmarks,
      strokePhase: currentStrokePhase,
      symmetryDeltaMm: currentSymmetry?.deltaHeightMm,
      symmetryAngleDeg: currentSymmetry?.symmetryAngleDeg,
      symmetryScorePercent: currentSymmetry?.symmetryScorePercent,
      hoverLandmark: interactionManager.getHoverLandmark(),
      activePin: interactionManager.getActivePin(),
      comparisonMode: comparisonRig.getComparisonMode(),
      pinCount: interactionManager.getPins().length,
      interactiveFlight: interactiveFlight.getTelemetry(),
    });
  };

  // Submodule: interaction manager (raycasting, pins, probes)
  const interactionManager = createFlightLabInteractionManager({
    domElement: renderer.domElement,
    scene,
    getActiveCamera: () => cameraController.getActiveCamera(),
    getModel: () => model,
    getActiveSpecimen: () => activeSpecimen,
    getCurrentClip: () => currentClip,
    getPlaybackSnapshot,
    getCurrentStrokePhase: () => currentStrokePhase,
    events,
    onTelemetryDirty: publishTelemetry,
  });

  const resize = () => {
    const width = container.clientWidth || 900;
    const height = container.clientHeight || 620;
    cameraController.updateProjection(width, height);
    renderer.setSize(width, height);
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(container);

  const resolveAction = (name: string): { actionName: string; action: THREE.AnimationAction } | null => {
    const direct = actions.get(name);
    if (direct) return { actionName: name, action: direct };

    const lower = name.toLowerCase();
    for (const [key, act] of actions.entries()) {
      if (key.toLowerCase() === lower) {
        return { actionName: key, action: act };
      }
    }

    const aliases: Record<string, string[]> = {
      walk: ["groundwalk", "walk", "trot", "run"],
      groundwalk: ["walk", "groundwalk"],
      idle: ["idle", "groundidle", "stand"],
      rest: ["rest", "idle", "groundwalk"],
      cruise: ["flightcruise", "cruise", "glide", "fly"],
      flightcruise: ["cruise", "flightcruise"],
      hover: ["hover", "flightcruise", "cruise"],
      scout: ["scout", "glide", "flightcruise", "cruise"],
      glide: ["glide", "flightcruise", "cruise"],
      dive: ["dive", "speed", "flightcruise", "cruise"],
      speed: ["speed", "flightcruise", "cruise"],
      takeoff: ["takeoff", "flightcruise", "cruise"],
      land: ["land", "idle", "groundwalk"],
      attack: ["attackbite", "attack", "bite"],
      attack2: ["attackclaw", "attack2", "claw"],
      breath: ["roar", "breath", "firebreath"],
      death: ["death", "fall"],
    };

    const candidates = aliases[lower];
    if (candidates) {
      for (const candidate of candidates) {
        for (const [key, act] of actions.entries()) {
          const kLower = key.toLowerCase();
          if (kLower === candidate || kLower.includes(candidate)) {
            return { actionName: key, action: act };
          }
        }
      }
    }

    const modeClip = resolveFlightLabClip(lower as FlightLabMode, [...actions.keys()]);
    if (modeClip && actions.has(modeClip)) {
      return { actionName: modeClip, action: actions.get(modeClip)! };
    }

    const oneShotResult = resolveOneShotCapability(name, [...actions.keys()]);
    if (oneShotResult.clipName && actions.has(oneShotResult.clipName)) {
      return { actionName: oneShotResult.clipName, action: actions.get(oneShotResult.clipName)! };
    }

    for (const [key, act] of actions.entries()) {
      if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
        return { actionName: key, action: act };
      }
    }

    return null;
  };

  const play = (name: string, fade = 0.24) => {
    const resolved = resolveAction(name);
    if (!resolved) return;
    const { actionName, action: next } = resolved;
    name = actionName;

    const effectiveRate = getEffectiveRate();
    if (next === activeAction) {
      next.setEffectiveTimeScale(effectiveRate);
      return;
    }

    const prevClip = currentClip;
    const prevTime = activeAction ? activeAction.time : 0;
    const prevDuration = activeAction ? activeAction.getClip().duration : 0;
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(effectiveRate);
    const isTransitionMode = mode === "takeoff" || mode === "land";
    const shouldLoop = isLooping && !isTransitionMode;
    next.setLoop(shouldLoop ? THREE.LoopRepeat : THREE.LoopOnce, shouldLoop ? Infinity : 1);
    next.clampWhenFinished = !shouldLoop;
    if (shouldLoop && activeAction) {
      next.time = resolvePhasePreservingCrossfadeTime(
        prevClip,
        name,
        prevTime,
        prevDuration,
        next.getClip().duration
      );
    }
    next.play();
    if (activeAction) next.crossFadeFrom(activeAction, fade, true);
    activeAction = next;
    currentClip = name;
    events.activeClip?.(name);

    comparisonRig.syncAction(mode, effectiveRate, name);

    const clipDuration = next.getClip().duration;
    const specName = activeSpecimen?.name ?? "Model";
    console.log(`[FlightLab Animation] ${specName} ▶ "${name}" (${clipDuration.toFixed(2)}s, rate: ${effectiveRate.toFixed(2)}x, fade: ${fade}s)`);
    events.animationLog?.({
      id: `${Date.now()}-clip-${name}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString(),
      type: "clip",
      message: `Playing "${name}" (${clipDuration.toFixed(2)}s)${prevClip && prevClip !== name && prevClip !== "None" ? ` crossfaded from "${prevClip}"` : ""}`,
      details: `fade: ${fade}s · rate: ${effectiveRate.toFixed(2)}x`,
    });
    publishTelemetry();
  };

  const playMode = () => {
    const clip = resolveFlightLabClip(mode, [...actions.keys()]);
    if (clip) play(clip);
  };

  const clearModel = () => {
    loadController?.abort();
    loadController = null;
    mixer?.stopAllAction();
    skeletonDiagnostics.dispose();
    membraneSurface?.dispose();
    membraneSurface = null;
    if (model) {
      model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const orig = mesh.userData.__origMaterial;
        if (orig) mesh.material = orig;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => material.dispose());
      });
      model.removeFromParent();
    }
    neckSpring.detach();
    flightRig?.reset();
    flightRig = null;
    model = null;
    mixer = null;
    actions.clear();
    activeAction = null;
    isOneShot = false;
    isDeath = false;
    currentLandmarks = [];
  };

  let previous = performance.now();
  let frame = 0;

  const updateMixer = (step: number) => {
    if (!mixer) return;
    mixer.update(step);
    // Guarantee scene graph receives evaluated clip pose on every frame,
    // preventing procedural compounding on bones with static keyframe tracks.
    const bindings = (mixer as any)._bindings;
    if (bindings) {
      const offset = (mixer as any)._accuIndex;
      for (let i = 0, n = bindings.length; i < n; i++) {
        const b = bindings[i];
        const stride = b.valueSize;
        b.binding.setValue(b.buffer, offset * stride + stride);
      }
    }
  };

  const evaluateScrubbedPose = (stepDt: number) => {
    if (!model) return;
    let scrubKinematics: FlightKinematics | null = null;
    if (!isDeath) {
      const clipLower = currentClip.toLowerCase();
      const isGroundClip =
        mode === "ground" ||
        clipLower.includes("walk") ||
        clipLower.includes("idle") ||
        clipLower.includes("rest") ||
        clipLower.includes("death") ||
        clipLower === "attack" ||
        clipLower === "attack2" ||
        clipLower.includes("breath");
      const groundClearance =
        isGroundClip && mode !== "takeoff" && mode !== "land"
          ? 0
          : Math.max(0, currentAltitudeY - GROUND_ALTITUDE_Y);
      scrubKinematics = {
        horizontalSpeed: isGroundClip && mode !== "takeoff" ? (clipLower.includes("walk") ? 3.5 : 0) : dynamicAirspeed,
        verticalSpeed: dynamicVerticalSpeed,
        pitch: model.rotation.x,
        bank: model.rotation.z,
        yaw: 0,
        turnRate: model.rotation.z * 1.2,
        groundClearance,
        flightMode: mode === "ground" ? "ground" : mode === "takeoff" ? "takeoff" : mode === "land" ? "land" : undefined,
        clipName: currentClip,
        clipTime: activeAction ? activeAction.time : 0,
        wingStrokePhase: currentStrokePhase === "downstroke" ? 1.0 : currentStrokePhase === "upstroke" ? -1.0 : 0.0,
        isMouthActionActive: clipLower.includes("breath") || clipLower.includes("attack"),
      };
      flightRig?.update(scrubKinematics, null, stepDt);
    }
    membraneSurface?.update();
    currentLandmarks = resolveAnatomicalLandmarks(model);
    currentSymmetry = measureBilateralSymmetry(currentLandmarks);
    interactionManager.updateLandmarks(currentLandmarks);
    if (showProbes) {
      interactionManager.updateProbesVisuals(true);
    }
    comparisonRig.syncFrame(model, activeAction, scrubKinematics, stepDt);
  };

  const render = (time: number) => {
    if (disposed) return;
    frame = requestAnimationFrame(render);
    const delta = Math.min((time - previous) / 1000, 0.05);
    previous = time;

    if (!paused) {
      elapsed += delta;
      updateMixer(delta);
      if (!flightRig) {
        neckSpring.tick(delta);
      }
    }

    environment.tick(paused ? 0 : delta, mode, elapsed, paused);
    skeletonDiagnostics.tick();
    interactionManager.tick(delta);

    let targetRoll = 0;
    if (mode === "bank-left") {
      targetRoll = 0.42;
    } else if (mode === "bank-right") {
      targetRoll = -0.42;
    }

    let targetPitch = 0;
    if (mode === "takeoff") {
      const clipDuration = activeAction?.getClip().duration || 3.0;
      const t = activeAction ? activeAction.time : 0;
      if (t <= 0.75) {
        currentAltitudeY = GROUND_ALTITUDE_Y;
        targetPitch = 0;
        dynamicAirspeed = 0;
      } else if (t < clipDuration - 0.5) {
        const climbP = (t - 0.75) / Math.max(0.1, clipDuration - 1.25);
        const smoothClimb = THREE.MathUtils.smoothstep(climbP, 0, 1);
        currentAltitudeY = THREE.MathUtils.lerp(GROUND_ALTITUDE_Y, FLIGHT_ALTITUDE_Y, smoothClimb);
        targetPitch = -0.24;
        dynamicAirspeed = THREE.MathUtils.lerp(0, 18, smoothClimb);
      } else {
        currentAltitudeY = FLIGHT_ALTITUDE_Y;
        targetPitch = 0;
        dynamicAirspeed = 18;
      }

      if (!paused && activeAction && t >= clipDuration - 0.2) {
        mode = "cruise";
        currentAltitudeY = FLIGHT_ALTITUDE_Y;
        dynamicAirspeed = 18;
        events.mode?.("cruise");
        playMode();
        events.animationLog?.({
          id: `${Date.now()}-takeoff-finished`,
          timestamp: new Date().toLocaleTimeString(),
          type: "mode",
          message: 'Takeoff completed → Transitioned to "cruise"',
          details: "airborne cruise loop engaged",
        });
      }
    } else if (mode === "land") {
      const clipDuration = activeAction?.getClip().duration || 3.0;
      const t = activeAction ? activeAction.time : 0;
      const isLandClip = currentClip.toLowerCase().includes("land");

      if (isLandClip) {
        if (t <= 0.6) {
          currentAltitudeY = FLIGHT_ALTITUDE_Y;
          targetPitch = 0.16;
          dynamicAirspeed = 18;
        } else if (t < clipDuration - 0.7) {
          const sinkP = (t - 0.6) / Math.max(0.1, clipDuration - 1.3);
          const smoothSink = THREE.MathUtils.smoothstep(sinkP, 0, 1);
          currentAltitudeY = THREE.MathUtils.lerp(FLIGHT_ALTITUDE_Y, GROUND_ALTITUDE_Y, smoothSink);
          targetPitch = THREE.MathUtils.lerp(0.16, 0.04, smoothSink);
          dynamicAirspeed = THREE.MathUtils.lerp(18, 4, smoothSink);
        } else {
          currentAltitudeY = GROUND_ALTITUDE_Y;
          targetPitch = 0;
          dynamicAirspeed = 0;
        }

        if (!paused && activeAction && t >= clipDuration - 0.15) {
          mode = "ground";
          currentAltitudeY = GROUND_ALTITUDE_Y;
          dynamicAirspeed = 0;
          events.mode?.("ground");
          playMode();
          events.animationLog?.({
            id: `${Date.now()}-land-finished`,
            timestamp: new Date().toLocaleTimeString(),
            type: "mode",
            message: 'Landing completed → Settled into "ground"',
            details: "quadrupedal idle resting pose",
          });
        }
      } else {
        if (!paused) {
          currentAltitudeY = THREE.MathUtils.damp(currentAltitudeY, GROUND_ALTITUDE_Y, 2.5, delta);
          dynamicAirspeed = THREE.MathUtils.damp(dynamicAirspeed, 0, 2.5, delta);
          if (currentAltitudeY <= GROUND_ALTITUDE_Y + 0.08) {
            currentAltitudeY = GROUND_ALTITUDE_Y;
            dynamicAirspeed = 0;
            mode = "ground";
            events.mode?.("ground");
            playMode();
          }
        }
      }
    } else {
      if (mode === "boost") {
        targetPitch = 0.08;
        dynamicAirspeed = 36;
      } else if (mode === "ground") {
        targetPitch = 0;
        dynamicAirspeed = 0;
      } else if (currentClip.toLowerCase().includes("hover") || currentClip.toLowerCase().includes("scout")) {
        targetPitch = 0;
        dynamicAirspeed = 2;
      } else {
        targetPitch = 0;
        dynamicAirspeed = 18;
      }
      const targetAltitude = mode === "ground" ? GROUND_ALTITUDE_Y : FLIGHT_ALTITUDE_Y;
      if (!paused) {
        const dampRate = mode === "ground" ? 6.0 : 4.0;
        currentAltitudeY = THREE.MathUtils.damp(currentAltitudeY, targetAltitude, dampRate, delta);
      }
    }

    if (!paused && delta > 0) {
      dynamicVerticalSpeed = (currentAltitudeY - prevAltitudeY) / delta;
    } else {
      dynamicVerticalSpeed = 0;
    }
    prevAltitudeY = currentAltitudeY;

    let lastFrameKinematics: FlightKinematics | null = null;
    if (model) {
      const basePos = (model.userData.basePosition as THREE.Vector3 | undefined) ?? new THREE.Vector3();
      if (interactiveFlight.isActive()) {
        interactiveFlight.tick(paused ? 0 : delta);
        const flightPos = interactiveFlight.getPosition();
        const flightRot = interactiveFlight.getRotation();
        model.position.set(
          basePos.x + flightPos.x,
          basePos.y + flightPos.y,
          basePos.z + flightPos.z
        );
        model.rotation.copy(flightRot);
      } else {
        if (!paused) {
          model.rotation.z = THREE.MathUtils.lerp(model.rotation.z, targetRoll, 0.075);
          model.rotation.x = THREE.MathUtils.lerp(model.rotation.x, targetPitch, 0.075);
        }
        const flightBob =
          !paused && mode !== "ground" && currentAltitudeY > -5.0 ? Math.sin(elapsed * 1.6) * 0.16 : 0;
        model.position.set(
          basePos.x,
          basePos.y + currentAltitudeY + flightBob,
          basePos.z
        );
      }


      if (!isDeath) {
        const isInteractive = interactiveFlight.isActive();
        const clipLower = currentClip.toLowerCase();
        const isGroundClip =
          mode === "ground" ||
          clipLower.includes("walk") ||
          clipLower.includes("idle") ||
          clipLower.includes("rest") ||
          clipLower.includes("death") ||
          clipLower === "attack" ||
          clipLower === "attack2" ||
          clipLower.includes("breath");

        const airspeed = isInteractive
          ? interactiveFlight.getTelemetry().airspeedMps
          : isGroundClip && mode !== "takeoff"
          ? (clipLower.includes("walk") ? 3.5 : 0)
          : dynamicAirspeed;

        const verticalSpeed = isInteractive
          ? interactiveFlight.getTelemetry().verticalSpeedMps
          : dynamicVerticalSpeed;

        const groundClearance =
          isGroundClip && mode !== "takeoff" && mode !== "land"
            ? 0
            : Math.max(0, currentAltitudeY - GROUND_ALTITUDE_Y);

        const clipTime = activeAction ? activeAction.time : 0;
        const strokePhaseVal =
          currentStrokePhase === "downstroke" ? 1.0 : currentStrokePhase === "upstroke" ? -1.0 : 0.0;

        const resolvedFlightMode =
          mode === "takeoff" || clipLower.includes("takeoff")
            ? "takeoff"
            : mode === "land" || clipLower.includes("land")
            ? "land"
            : mode === "ground"
            ? "ground"
            : clipLower.includes("hover")
            ? "hover"
            : clipLower.includes("scout")
            ? "scout"
            : clipLower.includes("dive")
            ? "dive"
            : clipLower.includes("speed")
            ? "speed"
            : clipLower.includes("glide")
            ? "glide"
            : undefined;

        lastFrameKinematics = {
          horizontalSpeed: airspeed,
          verticalSpeed,
          pitch: model.rotation.x,
          bank: model.rotation.z,
          yaw: 0,
          turnRate: model.rotation.z * 1.2,
          groundClearance,
          flightMode: resolvedFlightMode,
          clipName: currentClip,
          clipTime,
          wingStrokePhase: strokePhaseVal,
          isMouthActionActive:
            clipLower.includes("breath") ||
            clipLower.includes("attack"),
        };
        if (!paused) {
          flightRig?.update(lastFrameKinematics, null, delta);
        }
      }

      membraneSurface?.update();

      // Update landmarks and metrics
      currentLandmarks = resolveAnatomicalLandmarks(model);
      currentSymmetry = measureBilateralSymmetry(currentLandmarks);
      const strokeResult = detectStrokePhase(currentLandmarks, prevTipY, delta, mode !== "ground");
      currentStrokePhase = strokeResult.phase;
      prevTipY = strokeResult.tipY;

      interactionManager.updateLandmarks(currentLandmarks);
      if (showProbes) {
        interactionManager.updateProbesVisuals(true);
      }

      vortexTrails.update(
        model,
        showStreamlines,
        activeSpecimen ? activeSpecimen.targetSize : 8,
        paused ? 0 : delta,
        mode
      );

      computeCenterOfMassAnchor(
        currentLandmarks,
        model,
        activeSpecimen ? activeSpecimen.targetSize : 8,
        cameraFollowAnchor
      );
    }

    const anchorArg = model ? cameraFollowAnchor : undefined;
    cameraController.tick(delta, environment.cameraFill, anchorArg);

    // Synchronize comparison model animation, procedural rig, and membrane surface
    comparisonRig.syncFrame(model, activeAction, lastFrameKinematics, delta);

    renderer.render(scene, cameraController.getActiveCamera());
  };

  frame = requestAnimationFrame(render);
  telemetryInterval = setInterval(publishTelemetry, 80);

  const setTheme = (theme: FlightLabTheme) => {
    themeState = theme;
    environment.setTheme(theme, renderer);
    skeletonDiagnostics.setTheme(theme);
    silhouetteDiagnostics.setTheme(theme);
    vortexTrails.setTheme(theme);
  };

  const dumpDiagnostics = (): string => {
    const report = formatDiagnosticsReport({
      specimen: activeSpecimen,
      currentClip,
      snapshot: getPlaybackSnapshot(),
      mode,
      strokePhase: currentStrokePhase,
      symmetry: currentSymmetry,
      landmarks: currentLandmarks,
      pins: interactionManager.getPins(),
    });

    console.log(report);
    events.animationLog?.({
      id: `${Date.now()}-dump`,
      timestamp: new Date().toLocaleTimeString(),
      type: "rig",
      message: `Exported rig diagnostic dump (${currentLandmarks.length} landmarks, ${interactionManager.getPins().length} pins)`,
      details: "Full diagnostics logged to browser console",
    });
    return report;
  };

  const runtimeInstance: FlightLabRuntime = {
    async loadSpecimen(specimen) {
      clearModel();
      activeSpecimen = specimen;
      const controller = new AbortController();
      loadController = controller;
      events.loading?.(true);
      events.clips?.([]);
      events.clipDetails?.([]);
      events.metrics?.(null);
      events.error?.(null);
      currentClip = "Loading...";
      publishTelemetry();
      try {
        const gltf = await loadModelFile(specimen.modelFile, controller.signal);
        if (!gltf || disposed || controller.signal.aborted) return;
        model = normalizedClone(gltf.scene, specimen.targetSize);
        model.name = `FlightLab:${specimen.id}`;
        model.rotation.y = specimen.heading;
        cloneMaterials(model);
        configureShadows(model, "hero");
        membraneSurface = createMembraneSurfaceRuntime(model);

        const basePosition = model.position.clone();
        model.userData.basePosition = basePosition;
        model.position.set(basePosition.x, basePosition.y + currentAltitudeY, basePosition.z);

        world.add(model);

        if (showWireframe) applyWireframe(model, true);
        if (showSilhouette) silhouetteDiagnostics.apply(model, true);
        if (showSkeleton) skeletonDiagnostics.update(model, true);

        // Calculate and emit mesh metrics
        const meshMetrics = computeMeshMetrics(model);
        events.metrics?.(meshMetrics);

        // Align floor to model feet and fit initial camera
        const bbox = new THREE.Box3().setFromObject(model);
        environment.setFloorY(GROUND_ALTITUDE_Y - 0.03);
        cameraController.setPreset("chase");

        mixer = new THREE.AnimationMixer(model);
        neckSpring.attach(model);
        flightRig = isV2RigSpecimen(specimen) ? createWyvernFlightRig(model) : null;
        mixer.addEventListener("finished", (e: any) => {
          const finishedAction = e?.action as THREE.AnimationAction | undefined;
          if (finishedAction !== activeAction) return;

          if (isDeath) {
            paused = true;
            activeAction.paused = true;
            publishTelemetry();
            events.animationLog?.({
              id: `${Date.now()}-death-finished`,
              timestamp: new Date().toLocaleTimeString(),
              type: "state",
              message: "Death action completed (pose held)",
            });
            return;
          }

          if (mode === "takeoff") {
            mode = "cruise";
            currentAltitudeY = FLIGHT_ALTITUDE_Y;
            prevAltitudeY = FLIGHT_ALTITUDE_Y;
            dynamicAirspeed = 18;
            dynamicVerticalSpeed = 0;
            events.mode?.("cruise");
            playMode();
            return;
          }

          if (mode === "land") {
            mode = "ground";
            currentAltitudeY = GROUND_ALTITUDE_Y;
            prevAltitudeY = GROUND_ALTITUDE_Y;
            dynamicAirspeed = 0;
            dynamicVerticalSpeed = 0;
            events.mode?.("ground");
            playMode();
            return;
          }

          if (isOneShot) {
            isOneShot = false;
            playMode();
            return;
          }

          if (!isLooping) {
            paused = true;
            activeAction.paused = true;
            publishTelemetry();
          }
        });

        actions.clear();
        actions = new Map(gltf.animations.map((clip, index) => {
          const name = clip.name || `Clip ${index + 1}`;
          return [name, mixer!.clipAction(clip)] as const;
        }));
        const names = [...actions.keys()];
        const details: FlightLabAnimationClipInfo[] = gltf.animations.map((clip, index) => ({
          name: clip.name || `Clip ${index + 1}`,
          duration: Number(clip.duration.toFixed(2)),
          tracksCount: clip.tracks.length,
        }));
        events.clips?.(names);
        events.clipDetails?.(details);

        if (details.length > 0) {
          const totalTracks = details.reduce((sum, item) => sum + item.tracksCount, 0);
          console.groupCollapsed(`[FlightLab] Model "${specimen.name}" (${specimen.modelFile}) - ${details.length} animation clips, ${totalTracks} tracks`);
          console.table(details.map((clip, index) => ({
            "#": index + 1,
            "Clip Name": clip.name,
            "Duration (s)": clip.duration,
            "Frames (@60fps)": Math.round(clip.duration * 60),
            "Tracks": clip.tracksCount,
          })));
          console.groupEnd();
          events.animationLog?.({
            id: `${Date.now()}-load-${specimen.id}`,
            timestamp: new Date().toLocaleTimeString(),
            type: "load",
            message: `Loaded ${specimen.name}: ${details.length} animation clips (${totalTracks} tracks)`,
            details: specimen.modelFile,
          });
        } else {
          console.info(`[FlightLab] Model "${specimen.name}" (${specimen.modelFile}) has no skeletal animation clips (static mesh).`);
          events.animationLog?.({
            id: `${Date.now()}-load-${specimen.id}`,
            timestamp: new Date().toLocaleTimeString(),
            type: "load",
            message: `Loaded ${specimen.name}: Static mesh (0 animation clips)`,
            details: specimen.modelFile,
          });
        }

        currentClip = names.length ? names[0]! : (specimen.kind === "egg" ? "Incubation" : "Static pose");
        events.activeClip?.(currentClip);
        events.mode?.(mode);
        playMode();

        // If comparison mode was active, reload matching comparison rig
        if (comparisonRig.getComparisonMode() !== "off") {
          const otherId = specimen.id === "wyvern-v1-rig" ? "wyvern-v2-rig" : "wyvern-v1-rig";
          void comparisonRig.loadComparisonRig(
            otherId,
            comparisonRig.getComparisonMode(),
            activeSpecimen,
            model,
            actions.size,
            mode,
            getEffectiveRate()
          );
        }

        publishTelemetry();
      } catch (error) {
        if (!controller.signal.aborted) {
          const err = error instanceof Error ? error : new Error(String(error));
          events.error?.(err);
          currentClip = "Error";
          publishTelemetry();
        }
      } finally {
        if (loadController === controller) loadController = null;
        if (!controller.signal.aborted) events.loading?.(false);
      }
    },
    setMode(nextMode) {
      if (activeSpecimen && !canSpecimenExecuteMode(activeSpecimen.kind, nextMode)) {
        console.warn(`[FlightLab] Specimen "${activeSpecimen.name}" cannot execute mode "${nextMode}"`);
        return;
      }
      isOneShot = false;
      isDeath = false;
      if (nextMode === "takeoff") {
        currentAltitudeY = GROUND_ALTITUDE_Y;
        prevAltitudeY = GROUND_ALTITUDE_Y;
        dynamicAirspeed = 0;
        dynamicVerticalSpeed = 0;
      } else if (nextMode === "land" && currentAltitudeY <= GROUND_ALTITUDE_Y + 0.1) {
        currentAltitudeY = FLIGHT_ALTITUDE_Y;
        prevAltitudeY = FLIGHT_ALTITUDE_Y;
        dynamicAirspeed = 18;
        dynamicVerticalSpeed = 0;
      } else if (nextMode === "ground") {
        dynamicAirspeed = 0;
      } else if (nextMode === "boost") {
        dynamicAirspeed = 36;
      } else {
        dynamicAirspeed = 18;
      }
      mode = nextMode;
      events.mode?.(mode);
      const targetClip = resolveFlightLabClip(mode, [...actions.keys()]);
      events.animationLog?.({
        id: `${Date.now()}-mode-${nextMode}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toLocaleTimeString(),
        type: "mode",
        message: `Flight state set to "${nextMode}"`,
        details: targetClip ? `target clip: "${targetClip}"` : "no matching clip",
      });
      playMode();
      if (activeAction) {
        activeAction.setEffectiveTimeScale(getEffectiveRate());
      }
      publishTelemetry();
    },
    playClip(name) {
      isOneShot = false;
      isDeath = isDeathAction(name);
      const ctx = resolveClipFlightContext(name);
      mode = ctx.mode;
      currentAltitudeY = ctx.airborne ? FLIGHT_ALTITUDE_Y : GROUND_ALTITUDE_Y;
      prevAltitudeY = currentAltitudeY;
      dynamicAirspeed = ctx.airspeed;
      dynamicVerticalSpeed = 0;
      events.mode?.(mode);
      play(name, 0.16);
    },
    playOneShot(name: string) {
      if (activeSpecimen && !canSpecimenExecuteOneShot(activeSpecimen.kind)) {
        console.warn(`[FlightLab] Specimen "${activeSpecimen.name}" cannot execute one-shot actions`);
        return;
      }
      const resolved = resolveOneShotCapability(name, [...actions.keys()]);
      const targetName = resolved.clipName;
      if (!targetName) {
        console.warn(`[FlightLab] One-shot clip "${name}" not found on specimen.`);
        return;
      }
      const next = actions.get(targetName);
      if (!next) return;

      const death = isDeathAction(targetName);
      isOneShot = !death;
      isDeath = death;

      const targetLower = targetName.toLowerCase();
      if (death || targetLower === "attack" || targetLower === "attack2" || targetLower.includes("breath")) {
        mode = "ground";
        currentAltitudeY = GROUND_ALTITUDE_Y;
        events.mode?.("ground");
      } else if (targetLower.includes("attackair")) {
        mode = "cruise";
        currentAltitudeY = FLIGHT_ALTITUDE_Y;
        events.mode?.("cruise");
      }

      const effectiveRate = getEffectiveRate();
      next.reset()
        .setEffectiveWeight(1)
        .setEffectiveTimeScale(effectiveRate)
        .setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = death;
      next.play();
      if (activeAction && activeAction !== next) {
        next.crossFadeFrom(activeAction, 0.16, true);
      }
      activeAction = next;
      currentClip = targetName;
      events.activeClip?.(targetName);

      events.animationLog?.({
        id: `${Date.now()}-oneshot-${targetName}`,
        timestamp: new Date().toLocaleTimeString(),
        type: "clip",
        message: death
          ? `⚡ Fall/Death action "${targetName}" triggered (clamps on completion)`
          : `⚡ One-shot action "${targetName}" triggered (auto-returning to ${mode})`,
        details: `fade 0.16s · rate: ${effectiveRate.toFixed(2)}x`,
      });
      publishTelemetry();
    },
    seek(timeSeconds: number) {
      if (!activeAction) return;
      const clip = activeAction.getClip();
      const dur = clip ? clip.duration : 1;
      const target = THREE.MathUtils.clamp(timeSeconds, 0, dur);
      activeAction.time = target;
      activeAction.paused = false;
      updateMixer(0);
      evaluateScrubbedPose(1 / inspectionFps);
      if (paused) {
        activeAction.paused = true;
      }
      publishTelemetry();
    },
    stepFrames(frames: number) {
      if (!activeAction) return;
      const clip = activeAction.getClip();
      const dur = clip ? clip.duration : 1;
      paused = true;
      const nextTime = calculateFrameStepTime(activeAction.time, frames, dur, isLooping, inspectionFps);
      activeAction.time = nextTime;
      activeAction.paused = false;
      updateMixer(0);
      evaluateScrubbedPose(Math.max(1 / 120, Math.abs(frames) / inspectionFps));
      activeAction.paused = true;
      publishTelemetry();
      events.animationLog?.({
        id: `${Date.now()}-step-${frames}`,
        timestamp: new Date().toLocaleTimeString(),
        type: "state",
        message: `Stepped ${frames > 0 ? `+${frames}` : frames} frame (${(frames * (1 / inspectionFps)).toFixed(3)}s @ ${inspectionFps}fps) → ${nextTime.toFixed(2)}s`,
      });
    },
    setInspectionFps(fps: number) {
      inspectionFps = THREE.MathUtils.clamp(fps, 12, 120);
      publishTelemetry();
      events.animationLog?.({
        id: `${Date.now()}-inspection-fps-${fps}`,
        timestamp: new Date().toLocaleTimeString(),
        type: "state",
        message: `Inspection sample rate set to ${inspectionFps} fps`,
      });
    },
    getPlaybackSnapshot,
    setLoop(loop: boolean) {
      isLooping = loop;
      if (activeAction) {
        activeAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
        activeAction.clampWhenFinished = !loop;
      }
      publishTelemetry();
      events.animationLog?.({
        id: `${Date.now()}-loop-${loop}`,
        timestamp: new Date().toLocaleTimeString(),
        type: "state",
        message: loop ? "Playback loop mode: REPEAT" : "Playback loop mode: PLAY ONCE",
      });
    },
    setPaused(value) {
      paused = value;
      if (activeAction) {
        activeAction.paused = value;
        if (!value) {
          const dur = activeAction.getClip().duration;
          if (!isLooping && dur > 0 && activeAction.time >= dur) {
            activeAction.time = 0;
            activeAction.reset().play();
            activeAction.setEffectiveTimeScale(getEffectiveRate());
          }
        }
      }
      publishTelemetry();
      events.animationLog?.({
        id: `${Date.now()}-state-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toLocaleTimeString(),
        type: "state",
        message: value ? "Animation playback paused" : "Animation playback resumed",
      });
    },
    setSpeed(value) {
      speedScale = THREE.MathUtils.clamp(value, MIN_SPEED_SCALE, MAX_SPEED_SCALE);
      const effectiveScale = getEffectiveRate();
      activeAction?.setEffectiveTimeScale(effectiveScale);
      publishTelemetry();
      events.animationLog?.({
        id: `${Date.now()}-speed-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toLocaleTimeString(),
        type: "speed",
        message: `Playback rate set to ${speedScale.toFixed(2)}x`,
        details: mode === "boost" ? `boost effective: ${effectiveScale.toFixed(2)}x` : undefined,
      });
    },
    setTheme,
    setCameraPreset: cameraController.setPreset,
    setSkeleton(enabled: boolean) {
      showSkeleton = enabled;
      skeletonDiagnostics.update(model, enabled);
    },
    setWireframe(enabled: boolean) {
      showWireframe = enabled;
      applyWireframe(model, enabled);
    },
    setSilhouette(enabled: boolean) {
      showSilhouette = enabled;
      silhouetteDiagnostics.apply(model, enabled);
    },
    setStreamlines(enabled: boolean) {
      showStreamlines = enabled;
    },
    setAutoOrbit(enabled: boolean) {
      cameraController.setAutoOrbit(enabled);
    },
    setFloorVisible(enabled: boolean) {
      floorVisible = enabled;
      environment.setFloorVisible(enabled);
    },
    setProbesVisible(enabled: boolean) {
      showProbes = enabled;
      interactionManager.updateProbesVisuals(enabled);
      events.animationLog?.({
        id: `${Date.now()}-probes-${enabled}`,
        timestamp: new Date().toLocaleTimeString(),
        type: "rig",
        message: enabled ? "Anatomical joint probes enabled" : "Anatomical joint probes hidden",
      });
      publishTelemetry();
    },
    async setComparisonMode(nextMode) {
      comparisonRig.setComparisonMode(nextMode);
      if (nextMode === "off") {
        comparisonRig.clearComparisonModel();
        events.animationLog?.({
          id: `${Date.now()}-compare-off`,
          timestamp: new Date().toLocaleTimeString(),
          type: "compare",
          message: "Comparison overlay disabled",
        });
      } else {
        const otherId = activeSpecimen?.id === "wyvern-v1-rig" ? "wyvern-v2-rig" : "wyvern-v1-rig";
        await comparisonRig.loadComparisonRig(
          otherId,
          nextMode,
          activeSpecimen,
          model,
          actions.size,
          mode,
          getEffectiveRate()
        );
      }
      publishTelemetry();
    },
    createPinAtPointer(clientX: number, clientY: number) {
      return interactionManager.createPinAtPointer(clientX, clientY);
    },
    createPinFromLandmark(landmarkId: string) {
      return interactionManager.createPinFromLandmark(landmarkId);
    },
    removePin(pinId: string) {
      interactionManager.removePin(pinId);
    },
    clearPins() {
      interactionManager.clearPins();
    },
    getPins() {
      return interactionManager.getPins();
    },
    dumpDiagnostics,
    scanSeam() {
      if (!mixer || !activeAction || !model) {
        events.animationLog?.({
          id: `${Date.now()}-scan-fail`,
          timestamp: new Date().toLocaleTimeString(),
          type: "scan",
          message: "Seam scan failed: no active model or animation",
        });
        return;
      }
      const jumps = scanSeam(mixer, activeAction, model, inspectionFps, 0.25, isLooping);
      if (jumps.length === 0) {
        events.animationLog?.({
          id: `${Date.now()}-scan`,
          timestamp: new Date().toLocaleTimeString(),
          type: "scan",
          message: `Seam scan complete: no jumps > ${SEAM_JUMP_THRESHOLD_DEG}° detected (${isLooping ? "loop checked" : "one-shot mode"})`,
          details: `Threshold: ${SEAM_JUMP_THRESHOLD_DEG}° (${SEAM_THRESHOLD_PROVENANCE})`,
        });
      } else {
        const top = jumps.slice(0, 8);
        events.animationLog?.({
          id: `${Date.now()}-scan`,
          timestamp: new Date().toLocaleTimeString(),
          type: "scan",
          message: `Seam scan: ${jumps.length} jumps > ${SEAM_JUMP_THRESHOLD_DEG}° detected`,
          details: top.map((j) => `[${j.jumpType}] ${j.boneName} @ ${j.time.toFixed(2)}s (${j.angleDeg.toFixed(1)}°)`).join(", "),
        });
      }
      publishTelemetry();
    },
    exportEvidence() {
      if (!model) return;
      const { captureId } = exportEvidenceCapture({
        renderer,
        specimen: activeSpecimen,
        currentClip,
        snapshot: getPlaybackSnapshot(),
        mode,
        comparisonMode: comparisonRig.getComparisonMode(),
        cameraState: cameraController.getCameraState(),
        strokePhase: currentStrokePhase,
        symmetry: currentSymmetry,
        landmarks: currentLandmarks,
        pins: interactionManager.getPins(),
      });
      events.animationLog?.({
        id: `${Date.now()}-export`,
        timestamp: new Date().toLocaleTimeString(),
        type: "export",
        message: `Evidence exported: ${captureId} (PNG + JSON)`,
      });
    },
    zoomBy(amount) { cameraController.zoomBy(amount); },
    focusTarget(tx, ty, dist) { cameraController.focusTarget(tx, ty, dist); },
    resetCamera() { cameraController.setPreset("chase"); },
    fitCamera() {
      if (model) {
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        cameraController.fitSpecimen(box);
      }
    },
    setInteractiveFlightActive(active: boolean) {
      interactiveFlight.setActive(active);
      if (active) {
        mode = "cruise";
        playMode();
      }
      publishTelemetry();
    },
    isInteractiveFlightActive() {
      return interactiveFlight.isActive();
    },
    setInteractiveFlightInput(input: Partial<FlightInputState>) {
      interactiveFlight.setInput(input);
    },
    resetInteractiveFlight() {
      interactiveFlight.reset();
      if (model) {
        const basePos = (model.userData.basePosition as THREE.Vector3 | undefined) ?? new THREE.Vector3();
        model.position.copy(basePos);
        model.rotation.set(0, activeSpecimen?.heading || 0, 0);
      }
      publishTelemetry();
    },
    getCameraState() { return cameraController.getCameraState(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      if (telemetryInterval) {
        clearInterval(telemetryInterval);
        telemetryInterval = null;
      }
      observer.disconnect();
      interactionManager.dispose();
      clearModel();
      comparisonRig.dispose();
      cameraController.dispose();
      environment.dispose();
      skeletonDiagnostics.dispose();
      vortexTrails.dispose();
      world.clear();
      releaseWebGLRenderer(renderer);
      if (typeof window !== "undefined" && (window as any).__flightLab?.runtime === runtimeInstance) {
        delete (window as any).__flightLab;
      }
    },
  };

  // Attach global dev/agent bridge
  if (typeof window !== "undefined") {
    (window as any).__flightLab = {
      runtime: runtimeInstance,
      getPins: () => interactionManager.getPins(),
      getActivePin: () => interactionManager.getActivePin(),
      getHoverLandmark: () => interactionManager.getHoverLandmark(),
      getLandmarks: () => currentLandmarks,
      getSymmetry: () => currentSymmetry,
      getStrokePhase: () => currentStrokePhase,
      getComparisonSpecimen: () => comparisonRig.getComparisonSpecimen(),
      dumpDiagnostics,
      triggerPing: (x: number, y: number, z: number, colorHex?: string) =>
        interactionManager.triggerPing(new THREE.Vector3(x, y, z), colorHex),
    };
  }

  return runtimeInstance;
}
