"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { FLIGHT_LAB_SPECIMENS, findFlightLabSpecimen } from "../../flight-lab/catalog";
import {
  canSpecimenExecuteMode,
  canSpecimenExecuteOneShot,
  canSpecimenScrub,
  FLIGHT_LAB_SHORTCUTS,
  isEditableElement,
} from "../../flight-lab/playback";
import { serializeInspectionPreset } from "../../flight-lab/presetManager";
import {
  createFlightLabRuntime,
  type FlightLabAnimationClipInfo,
  type FlightLabAnimationEvent,
  type FlightLabCameraPreset,
  type FlightLabComparisonMetrics,
  type FlightLabComparisonMode,
  type FlightLabMeshMetrics,
  type FlightLabMode,
  type FlightLabRuntime,
  type FlightLabTelemetry,
  type FlightLabTheme,
} from "../../flight-lab/runtime";
import type { FlightLabContractWarning } from "../../flight-lab/types";
import styles from "./FlightLabClient.module.css";
import { AnimationLogConsole } from "./components/AnimationLogConsole";
import { FlightControls } from "./components/FlightControls";
import { PanelToggle } from "./components/PanelToggle";
import { SpecimenSidebar } from "./components/SpecimenSidebar";
import { StageViewport } from "./components/StageViewport";
import { QUICK_LOCOMOTION_ACTIONS } from "../../flight-lab/controlHelpers";
import type { FlightKeyStates } from "./components/FlightAvionicsOverlay";

// Derived from canonical FLIGHT_LAB_SHORTCUTS — do not maintain a parallel list here.
const MODE_SHORTCUTS = FLIGHT_LAB_SHORTCUTS.filter((s) => s.type === "mode") as {
  key: string;
  name: string;
  label: string;
  type: "mode" | "oneshot" | "playback";
}[];
const ONESHOT_SHORTCUTS = FLIGHT_LAB_SHORTCUTS.filter((s) => s.type === "oneshot");

const INITIAL_TELEMETRY: FlightLabTelemetry = {
  speed: 74,
  altitude: 86,
  bank: 0,
  clip: "Loading",
  clipDuration: 0,
  clipTime: 0,
  clipProgress: 0,
  cameraDistance: 22,
  isPlaying: false,
  speedScale: 1,
  effectiveRate: 1,
  inspectionFps: 24,
  isOrtho: false,
};

/** Below this width the docked panels become overlay drawers. */
const isDrawerWidth = () =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 1050px)").matches;

export default function FlightLabClient() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<FlightLabRuntime | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  const [specimenId, setSpecimenId] = useState("wyvern-v2-rig");
  const [searchQuery, setSearchQuery] = useState("");
  const [mode, setMode] = useState<FlightLabMode>("cruise");
  const [clips, setClips] = useState<string[]>([]);
  const [clipDetails, setClipDetails] = useState<FlightLabAnimationClipInfo[]>([]);
  const [logs, setLogs] = useState<FlightLabAnimationEvent[]>([]);
  const [copiedLog, setCopiedLog] = useState(false);
  const [copiedPin, setCopiedPin] = useState(false);
  const [savedPin, setSavedPin] = useState(false);
  const [copiedRig, setCopiedRig] = useState(false);
  const [activeClip, setActiveClip] = useState("");
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [telemetry, setTelemetry] = useState(INITIAL_TELEMETRY);
  const [metrics, setMetrics] = useState<FlightLabMeshMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contractWarning, setContractWarning] = useState<FlightLabContractWarning | null>(null);
  const [theme, setTheme] = useState<FlightLabTheme>("dark");
  const [cameraPreset, setCameraPreset] = useState<FlightLabCameraPreset>("chase");

  // Docked side-panel visibility (persisted)
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const leftPanelRef = useRef<HTMLElement>(null);
  const rightPanelRef = useRef<HTMLElement>(null);
  const leftToggleRef = useRef<HTMLButtonElement>(null);
  const rightToggleRef = useRef<HTMLButtonElement>(null);

  // Mobile nav disclosure (CSS-hidden above 768px, so it only matters there)
  const [navOpen, setNavOpen] = useState(false);

  // Diagnostic states
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [showWireframe, setShowWireframe] = useState(false);
  const [showSilhouette, setShowSilhouette] = useState(false);
  const [showStreamlines, setShowStreamlines] = useState(false);
  const [showProbes, setShowProbes] = useState(false);
  const [comparisonMode, setComparisonMode] = useState<FlightLabComparisonMode>("off");
  const [proceduralRig, setProceduralRig] = useState(true);
  const [autoOrbit, setAutoOrbit] = useState(false);
  const [floorVisible, setFloorVisible] = useState(false);
  const [interactiveFlightActive, setInteractiveFlightActive] = useState(false);
  const [flightKeyStates, setFlightKeyStates] = useState<FlightKeyStates>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    climb: false,
    dive: false,
    boost: false,
  });

  // Timeline scrubber states
  const [isLooping, setIsLooping] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);

  const specimen = findFlightLabSpecimen(specimenId);

  const filteredSpecimens = FLIGHT_LAB_SPECIMENS.filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    const compactQ = q.replace(/[\s\-_]+/g, "");
    const compactId = item.id.toLowerCase().replace(/[\s\-_]+/g, "");
    const compactName = item.name.toLowerCase().replace(/[\s\-_]+/g, "");

    const isRig1Query = compactQ === "rig1" || compactQ === "v1" || compactQ === "v1rig";
    if (isRig1Query && (item.id === "wyvern-v1-rig" || item.className.includes("v1"))) {
      return true;
    }

    const isRig2Query = compactQ === "rig2" || compactQ === "v2" || compactQ === "v2rig";
    if (isRig2Query && (item.id === "wyvern-v2-rig" || item.className.includes("v2"))) {
      return true;
    }

    return (
      compactId.includes(compactQ) ||
      compactName.includes(compactQ) ||
      item.id.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q) ||
      item.className.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.modelFile.toLowerCase().includes(q) ||
      item.kind.toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    if (!viewportRef.current) return;
    const runtime = createFlightLabRuntime(viewportRef.current, {
      loading: setLoading,
      clips: (next) => {
        setClips(next);
      },
      clipDetails: (next) => {
        setClipDetails(next);
      },
      activeClip: (next) => {
        setActiveClip(next);
      },
      metrics: (next) => {
        setMetrics(next);
      },
      playbackState: (snapshot) => {
        setPaused(snapshot.status !== "playing");
      },
      telemetry: (next) => {
        setTelemetry(next);
      },
      animationLog: (event) => {
        setLogs((prev) => [...prev.slice(-99), event]);
      },
      mode: (next) => {
        setMode(next);
      },
      error: (next) => setError(next ? next.message : null),
      contractWarning: (next) => setContractWarning(next),
    });
    runtimeRef.current = runtime;
    void runtime.loadSpecimen(findFlightLabSpecimen("wyvern-v2-rig"));
    const savedTheme = window.localStorage.getItem("flight-lab-theme") === "light" ? "light" : "dark";
    setTheme(savedTheme);
    runtime.setTheme(savedTheme);
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Restore persisted panel visibility once on mount. With no persisted
  // preference, start collapsed at drawer widths — "open" below 1050px means
  // a curtain over the stage (doc 38 §3.2). Layout effect: no first-paint flash.
  useLayoutEffect(() => {
    try {
      const raw = window.localStorage.getItem("flight-lab-panels");
      if (raw) {
        const parsed = JSON.parse(raw) as { left?: boolean; right?: boolean };
        if (typeof parsed.left === "boolean") setLeftPanelOpen(parsed.left);
        if (typeof parsed.right === "boolean") setRightPanelOpen(parsed.right);
        return;
      }
    } catch {
      // malformed or unavailable storage — fall through to width-aware defaults
    }
    if (isDrawerWidth()) {
      setLeftPanelOpen(false);
      setRightPanelOpen(false);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "flight-lab-panels",
        JSON.stringify({ left: leftPanelOpen, right: rightPanelOpen })
      );
    } catch {
      // storage unavailable — panel state stays session-only
    }
  }, [leftPanelOpen, rightPanelOpen]);

  // Close the mobile nav on Escape or an outside tap while it is open.
  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      const header = headerRef.current;
      if (header && !header.contains(event.target as Node)) setNavOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [navOpen]);

  // Drawer interactions (≤1050px): focus moves to the panel on open and back
  // to its toggle on close; Escape or a scrim click closes (doc 38 §4.6).
  const closeDrawers = useCallback(() => {
    setLeftPanelOpen(false);
    setRightPanelOpen(false);
  }, []);

  const toggleLeftPanel = useCallback(() => {
    const next = !leftPanelOpen;
    setLeftPanelOpen(next);
    if (isDrawerWidth()) {
      if (next) leftPanelRef.current?.focus();
      else leftToggleRef.current?.focus();
    }
  }, [leftPanelOpen]);

  const toggleRightPanel = useCallback(() => {
    const next = !rightPanelOpen;
    setRightPanelOpen(next);
    if (isDrawerWidth()) {
      if (next) rightPanelRef.current?.focus();
      else rightToggleRef.current?.focus();
    }
  }, [rightPanelOpen]);

  useEffect(() => {
    if (!leftPanelOpen && !rightPanelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || interactiveFlightActive) return;
      if (!isDrawerWidth()) return;
      if (leftPanelOpen) leftToggleRef.current?.focus();
      else rightToggleRef.current?.focus();
      closeDrawers();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [leftPanelOpen, rightPanelOpen, interactiveFlightActive, closeDrawers]);

  const selectSpecimen = (id: string) => {
    const nextSpecimen = findFlightLabSpecimen(id);
    setSpecimenId(id);
    setError(null);
    setLoading(true);
    // metrics intentionally kept: the sidebar shows the previous specimen's
    // measurements dimmed until the new ones arrive, instead of collapsing.
    setClips([]);
    setClipDetails([]);
    setActiveClip(nextSpecimen.kind === "egg" ? "Incubation" : "");
    setTelemetry({ ...INITIAL_TELEMETRY, clip: "Loading..." });
    setPaused(false);
    runtimeRef.current?.setPaused(false);
    if (nextSpecimen.kind === "egg") {
      setMode("ground");
      runtimeRef.current?.setMode("ground");
      setCameraPreset("profile");
      runtimeRef.current?.setCameraPreset("profile");
    }
    void runtimeRef.current?.loadSpecimen(nextSpecimen);
    // Master→detail: at drawer widths, picking a specimen hands back the stage.
    if (isDrawerWidth()) setLeftPanelOpen(false);
  };

  const retryLoad = () => {
    setError(null);
    setLoading(true);
    void runtimeRef.current?.loadSpecimen(specimen);
  };

  const selectMode = (nextMode: FlightLabMode) => {
    setMode(nextMode);
    runtimeRef.current?.setMode(nextMode);
  };

  const selectClip = (name: string) => {
    setActiveClip(name);
    runtimeRef.current?.playClip(name);
  };

  const togglePaused = () => {
    const isCurrentlyPaused = runtimeRef.current?.getPlaybackSnapshot().status !== "playing";
    runtimeRef.current?.setPaused(!isCurrentlyPaused);
  };

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      window.localStorage.setItem("flight-lab-theme", next);
      runtimeRef.current?.setTheme(next);
      return next;
    });
  };

  const selectCameraPreset = (preset: FlightLabCameraPreset) => {
    setCameraPreset(preset);
    runtimeRef.current?.setCameraPreset(preset);
  };

  // Diagnostics toggles
  const toggleSkeleton = () => {
    setShowSkeleton((current) => {
      const next = !current;
      runtimeRef.current?.setSkeleton(next);
      return next;
    });
  };

  const toggleWireframe = () => {
    setShowWireframe((current) => {
      const next = !current;
      runtimeRef.current?.setWireframe(next);
      return next;
    });
  };

  const toggleSilhouette = () => {
    setShowSilhouette((current) => {
      const next = !current;
      runtimeRef.current?.setSilhouette(next);
      return next;
    });
  };

  const toggleStreamlines = () => {
    setShowStreamlines((current) => {
      const next = !current;
      runtimeRef.current?.setStreamlines(next);
      return next;
    });
  };

  const toggleProbes = () => {
    setShowProbes((current) => {
      const next = !current;
      runtimeRef.current?.setProbesVisible(next);
      return next;
    });
  };

  const handleToggleComparison = (nextMode: FlightLabComparisonMode) => {
    setComparisonMode(nextMode);
    void runtimeRef.current?.setComparisonMode(nextMode);
  };

  const toggleProceduralRig = () => {
    setProceduralRig((current) => {
      const next = !current;
      runtimeRef.current?.setProceduralRigEnabled(next);
      return next;
    });
  };

  const toggleAutoOrbit = () => {
    setAutoOrbit((current) => {
      const next = !current;
      runtimeRef.current?.setAutoOrbit(next);
      return next;
    });
  };

  const toggleFloor = () => {
    setFloorVisible((current) => {
      const next = !current;
      runtimeRef.current?.setFloorVisible(next);
      return next;
    });
  };

  const triggerOneShot = (clipName: string) => {
    runtimeRef.current?.playOneShot(clipName);
  };

  // Scrubber handlers
  const handleScrubChange = (val: number) => {
    setScrubTime(val);
    runtimeRef.current?.seek(val);
  };

  const handleScrubStart = () => {
    setIsScrubbing(true);
    setScrubTime(telemetry.clipTime);
  };

  const handleScrubEnd = () => {
    setIsScrubbing(false);
  };

  const handleStepFrames = (delta: number) => {
    runtimeRef.current?.stepFrames(delta);
  };

  const toggleLoop = () => {
    setIsLooping((current) => {
      const next = !current;
      runtimeRef.current?.setLoop(next);
      return next;
    });
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const copyLogs = async () => {
    const text = logs
      .map(
        (entry) =>
          `[${entry.timestamp}] [${entry.type.toUpperCase()}] ${entry.message}${entry.details ? ` (${entry.details})` : ""}`
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLog(true);
      setTimeout(() => setCopiedLog(false), 2000);
    } catch {
      // clipboard fallback
    }
  };

  const handleCopyActivePin = async () => {
    if (!telemetry.activePin) return;
    try {
      await navigator.clipboard.writeText(telemetry.activePin.aiSnippet);
      setCopiedPin(true);
      setTimeout(() => setCopiedPin(false), 2200);
    } catch {
      // fallback
    }
  };

  const handleClearPins = () => {
    runtimeRef.current?.clearPins();
  };

  // Writes the ticket + screenshot into the repo instead of the clipboard, so the
  // next instruction to an agent can be a path. The runtime logs the outcome
  // (including the download fallback) either way.
  const handleSaveActivePin = async () => {
    const result = await runtimeRef.current?.saveActivePinEvidence();
    if (!result?.ok) return;
    setSavedPin(true);
    setTimeout(() => setSavedPin(false), 2600);
  };

  const handleDumpDiagnostics = async () => {
    const report = runtimeRef.current?.dumpDiagnostics();
    if (!report) return;
    // The console copy is for a human reading devtools; the clipboard copy is
    // what gets pasted into a ticket. Same string, so they cannot disagree.
    try {
      await navigator.clipboard.writeText(report);
      setCopiedRig(true);
      setTimeout(() => setCopiedRig(false), 2200);
    } catch {
      // clipboard fallback — the report is already in the console
    }
  };

  const handleUpdatePinNote = (note: string) => {
    runtimeRef.current?.updateActivePinNote(note);
  };

  const handleToggleInteractiveFlight = useCallback(() => {
    if (!runtimeRef.current) return;
    setInteractiveFlightActive((prev) => {
      const next = !prev;
      runtimeRef.current?.setInteractiveFlightActive(next);
      if (!next) {
        setFlightKeyStates({
          forward: false,
          backward: false,
          left: false,
          right: false,
          climb: false,
          dive: false,
          boost: false,
        });
      }
      return next;
    });
  }, []);

  const handleExportPreset = () => {
    if (!runtimeRef.current) return;
    const cam = runtimeRef.current.getCameraState();
    const snap = runtimeRef.current.getPlaybackSnapshot();
    const json = serializeInspectionPreset({
      presetName: `${specimen.name} - ${activeClip}`,
      specimenId: specimen.id,
      mode,
      clipName: activeClip,
      clipTime: snap.clipTime,
      speedScale: speed,
      inspectionFps: snap.inspectionFps,
      cameraState: cam,
      theme,
      showSkeleton,
      showWireframe,
      showSilhouette,
      showStreamlines,
      showProbes,
      comparisonMode,
    });
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `flight-preset-${specimen.id}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    const handleFlightKey = (e: KeyboardEvent, isDown: boolean) => {
      const code = e.code;
      const patch: any = {};
      if (code === "KeyW" || code === "ArrowUp") patch.forward = isDown;
      if (code === "KeyS" || code === "ArrowDown") patch.backward = isDown;
      if (code === "KeyA" || code === "ArrowLeft") patch.left = isDown;
      if (code === "KeyD" || code === "ArrowRight") patch.right = isDown;
      if (code === "Space" || code === "KeyR") patch.climb = isDown;
      if (code === "KeyC" || code === "KeyF") patch.dive = isDown;
      if (code === "ShiftLeft" || code === "ShiftRight") patch.boost = isDown;
      if (Object.keys(patch).length > 0) {
        runtimeRef.current?.setInteractiveFlightInput(patch);
        setFlightKeyStates((prev) => ({ ...prev, ...patch }));
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableElement(event.target)) {
        return;
      }
      if (event.repeat) return;

      if (interactiveFlightActive) {
        handleFlightKey(event, true);
        if (event.code === "Escape") {
          handleToggleInteractiveFlight();
        }
        return;
      }

      const selected = MODE_SHORTCUTS.find((item) => item.key === event.key);
      if (selected) {
        if (!canSpecimenExecuteMode(specimen.kind, selected.name as FlightLabMode)) return;
        setMode(selected.name as FlightLabMode);
        runtimeRef.current?.setMode(selected.name as FlightLabMode);
        return;
      }

      if (event.code === "Space") {
        if (!canSpecimenScrub(specimen.kind, clips.length)) return;
        event.preventDefault();
        const isCurrentlyPaused = runtimeRef.current?.getPlaybackSnapshot().status !== "playing";
        runtimeRef.current?.setPaused(!isCurrentlyPaused);
        return;
      }

      const keyUpper = event.key.toUpperCase();
      // `G` is the procedural-rig bypass. It has to be checked before the clip
      // shortcuts, and Glide moved to `L` so this does not shadow it.
      if (keyUpper === "G" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        setProceduralRig((current) => {
          const next = !current;
          runtimeRef.current?.setProceduralRigEnabled(next);
          return next;
        });
        return;
      }

      const locomotion = QUICK_LOCOMOTION_ACTIONS.find((a) => a.key === keyUpper);
      if (locomotion) {
        if (!canSpecimenExecuteMode(specimen.kind, "ground")) return;
        selectClip(locomotion.clipName);
        return;
      }

      const action = ONESHOT_SHORTCUTS.find((a) => a.key === keyUpper);
      if (action) {
        if (!canSpecimenExecuteOneShot(specimen.kind)) return;
        runtimeRef.current?.playOneShot(action.name);
        return;
      }

      if (event.key === "[" || event.key === "ArrowLeft") {
        if (!canSpecimenScrub(specimen.kind, clips.length)) return;
        event.preventDefault();
        runtimeRef.current?.stepFrames(-1);
      } else if (event.key === "]" || event.key === "ArrowRight") {
        if (!canSpecimenScrub(specimen.kind, clips.length)) return;
        event.preventDefault();
        runtimeRef.current?.stepFrames(1);
      } else if (event.key.toLowerCase() === "p") {
        toggleProbes();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (interactiveFlightActive) {
        handleFlightKey(event, false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [specimen.kind, clips.length, interactiveFlightActive, handleToggleInteractiveFlight]);

  return (
    <main className={styles.surface} data-theme={theme}>
      <header className={styles.header} ref={headerRef}>
        <div className={styles.brand}>
          <p className={styles.eyebrow}>HEARTHVALE · AERODYNAMICS RANGE 01</p>
          <h1>Wyvern Flight Lab</h1>
          <p className={styles.intro}>
            Debug the v2 rig. Inspect seams, landmarks, joint probes, and compare with V1 reference.
          </p>
        </div>
        <button
          type="button"
          className={styles.menuToggle}
          aria-expanded={navOpen}
          aria-controls="flight-lab-nav"
          aria-label={navOpen ? "Close navigation menu" : "Open navigation menu"}
          onClick={() => setNavOpen((open) => !open)}
        >
          <span className={styles.menuIcon} aria-hidden="true" />
          <span className={styles.menuLabel}>Menu</span>
        </button>
        <nav
          id="flight-lab-nav"
          className={styles.nav}
          data-open={navOpen ? "true" : "false"}
          aria-label="Flight Lab navigation"
        >
          <Link href="/" aria-current="page" onClick={() => setNavOpen(false)}>
            Flight Lab
          </Link>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            onClick={() => setNavOpen(false)}
          >
            Wyvern Rig Studio
          </a>
          <button
            type="button"
            className={styles.themeToggle}
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <span aria-hidden="true">{theme === "dark" ? "☀" : "◐"}</span>
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </nav>
      </header>

      <section
        className={styles.lab}
        data-left={leftPanelOpen ? "open" : "collapsed"}
        data-right={rightPanelOpen ? "open" : "collapsed"}
      >
        <SpecimenSidebar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          specimens={filteredSpecimens}
          selectedId={specimenId}
          onSelectSpecimen={selectSpecimen}
          specimen={specimen}
          clipDetailsCount={clipDetails.length}
          metrics={metrics}
          loading={loading}
          panelRef={leftPanelRef}
        />

        <StageViewport
          viewportRef={viewportRef}
          specimenName={specimen.name}
          loading={loading}
          error={error}
          contractWarning={contractWarning}
          onRetry={retryLoad}
          showSkeleton={showSkeleton}
          onToggleSkeleton={toggleSkeleton}
          showWireframe={showWireframe}
          onToggleWireframe={toggleWireframe}
          showSilhouette={showSilhouette}
          onToggleSilhouette={toggleSilhouette}
          showStreamlines={showStreamlines}
          onToggleStreamlines={toggleStreamlines}
          showProbes={showProbes}
          onToggleProbes={toggleProbes}
          comparisonMode={comparisonMode}
          onToggleComparison={handleToggleComparison}
          proceduralRig={proceduralRig}
          onToggleProceduralRig={toggleProceduralRig}
          autoOrbit={autoOrbit}
          onToggleAutoOrbit={toggleAutoOrbit}
          floorVisible={floorVisible}
          onToggleFloor={toggleFloor}
          telemetry={telemetry}
          onCopyActivePin={handleCopyActivePin}
          copiedPin={copiedPin}
          savedPin={savedPin}
          onSaveActivePin={handleSaveActivePin}
          onClearPins={handleClearPins}
          onUpdatePinNote={handleUpdatePinNote}
          onZoomBy={(amount) => runtimeRef.current?.zoomBy(amount)}
          onScanSeam={() => runtimeRef.current?.scanSeam()}
          onExportEvidence={() => runtimeRef.current?.exportEvidence()}
          interactiveFlightActive={interactiveFlightActive}
          onToggleInteractiveFlight={handleToggleInteractiveFlight}
          flightKeyStates={flightKeyStates}
        />

        <FlightControls
          specimenKind={specimen.kind}
          panelRef={rightPanelRef}
          mode={mode}
          onSelectMode={selectMode}
          modeCapabilities={telemetry.modeCapabilities}
          onTriggerOneShot={triggerOneShot}
          hasClips={clips.length > 0}
          cameraPreset={cameraPreset}
          onSelectCameraPreset={selectCameraPreset}
          activeClip={activeClip}
          clips={clips}
          clipDetails={clipDetails}
          onSelectClip={selectClip}
          speed={speed}
          onSpeedChange={(val) => {
            setSpeed(val);
            runtimeRef.current?.setSpeed(val);
          }}
          paused={paused}
          onTogglePaused={togglePaused}
          onResetCamera={() => runtimeRef.current?.resetCamera()}
          onFitCamera={() => runtimeRef.current?.fitCamera()}
          autoOrbit={autoOrbit}
          onToggleAutoOrbit={toggleAutoOrbit}
          onZoomBy={(amount) => runtimeRef.current?.zoomBy(amount)}
          cameraDistance={telemetry.cameraDistance}
          interactiveFlightActive={interactiveFlightActive}
          onToggleInteractiveFlight={handleToggleInteractiveFlight}
          onExportPreset={handleExportPreset}
          scrubber={{
            telemetry,
            isScrubbing,
            scrubTime,
            isLooping,
            onScrubStart: handleScrubStart,
            onScrubEnd: handleScrubEnd,
            onScrubChange: handleScrubChange,
            onStepFrames: handleStepFrames,
            onToggleLoop: toggleLoop,
            onSetInspectionFps: (fps) => runtimeRef.current?.setInspectionFps(fps),
          }}
          comparisonMode={comparisonMode}
          onToggleComparison={handleToggleComparison}
        >
          <AnimationLogConsole
            logs={logs}
            copied={copiedLog}
            onCopyLogs={copyLogs}
            onClearLogs={clearLogs}
            onDumpDiagnostics={handleDumpDiagnostics}
            copiedRig={copiedRig}
            logContainerRef={logContainerRef}
          />
        </FlightControls>

        {(leftPanelOpen || rightPanelOpen) && (
          <div className={styles.drawerScrim} aria-hidden="true" onClick={closeDrawers} />
        )}

        <PanelToggle
          side="left"
          open={leftPanelOpen}
          label="specimen panel"
          controls="specimen-panel"
          toggleRef={leftToggleRef}
          onToggle={toggleLeftPanel}
        />
        <PanelToggle
          side="right"
          open={rightPanelOpen}
          label="controls panel"
          controls="controls-panel"
          toggleRef={rightToggleRef}
          onToggle={toggleRightPanel}
        />
      </section>
    </main>
  );
}
