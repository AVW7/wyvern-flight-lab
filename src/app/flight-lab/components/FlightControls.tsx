"use client";

import { useEffect, useMemo, useRef, useState, type Ref } from "react";
import {
  CLIP_CATEGORIES,
  filterClips,
  categorizeClip,
  QUICK_LOCOMOTION_ACTIONS,
  type ClipCategory,
} from "../../../flight-lab/controlHelpers";
import { FLIGHT_LAB_SHORTCUTS } from "../../../flight-lab/playback";
import type { ClipResolutionResult } from "../../../flight-lab/clipResolver";
import type {
  FlightLabAnimationClipInfo,
  FlightLabCameraPreset,
  FlightLabComparisonMode,
  FlightLabMode,
} from "../../../flight-lab/runtime";
import styles from "../FlightLabClient.module.css";
import { ComparisonMatrixCard } from "./ComparisonMatrixCard";
import { TimelineScrubber, type TimelineScrubberProps } from "./TimelineScrubber";

const MODES_UI = FLIGHT_LAB_SHORTCUTS.filter((s) => s.type === "mode");
const ONE_SHOTS_UI = FLIGHT_LAB_SHORTCUTS.filter((s) => s.type === "oneshot");

const PERSP_PRESETS: { id: FlightLabCameraPreset; label: string; icon: string }[] = [
  { id: "chase", label: "Chase", icon: "⇱" },
  { id: "takeoff", label: "Takeoff", icon: "⇡" },
  { id: "detail", label: "Detail", icon: "⊕" },
  { id: "profile", label: "Profile", icon: "⇢" },
  { id: "front", label: "Front", icon: "▼" },
  { id: "top", label: "Top", icon: "▲" },
];

const ORTHO_PRESETS: { id: FlightLabCameraPreset; label: string; icon: string }[] = [
  { id: "frontOrtho", label: "Front", icon: "⊞" },
  { id: "sideOrtho", label: "Side", icon: "⊟" },
  { id: "topOrtho", label: "Top", icon: "⊠" },
  { id: "threeQuarterOrtho", label: "3/4", icon: "⧅" },
];

interface FlightControlsProps {
  children?: React.ReactNode;
  specimenKind: "wyvern" | "egg";
  panelRef?: Ref<HTMLElement>;
  mode: FlightLabMode;
  onSelectMode: (mode: FlightLabMode) => void;
  /** Per-mode resolution on the loaded asset; drives the ALIAS/FALLBACK/N/A badges. */
  modeCapabilities?: Partial<Record<FlightLabMode, ClipResolutionResult>>;
  onTriggerOneShot: (actionName: string) => void;
  hasClips: boolean;
  cameraPreset: FlightLabCameraPreset;
  onSelectCameraPreset: (preset: FlightLabCameraPreset) => void;
  activeClip: string;
  clips: string[];
  clipDetails: FlightLabAnimationClipInfo[];
  onSelectClip: (clip: string) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  paused: boolean;
  onTogglePaused: () => void;
  onResetCamera: () => void;
  onFitCamera?: () => void;
  autoOrbit?: boolean;
  onToggleAutoOrbit?: () => void;
  onZoomBy?: (amount: number) => void;
  cameraDistance?: number;
  interactiveFlightActive?: boolean;
  onToggleInteractiveFlight?: () => void;
  onExportPreset?: () => void;
  onImportPreset?: (json: string) => void;
  scrubber: TimelineScrubberProps;
  comparisonMode?: FlightLabComparisonMode;
  onToggleComparison?: (mode: FlightLabComparisonMode) => void;
}

export function FlightControls({
  children,
  specimenKind,
  panelRef,
  mode,
  onSelectMode,
  modeCapabilities,
  onTriggerOneShot,
  hasClips,
  cameraPreset,
  onSelectCameraPreset,
  activeClip,
  clips,
  clipDetails,
  onSelectClip,
  speed,
  onSpeedChange,
  paused,
  onTogglePaused,
  onResetCamera,
  onFitCamera,
  autoOrbit = false,
  onToggleAutoOrbit,
  onZoomBy,
  cameraDistance = 22,
  interactiveFlightActive = false,
  onToggleInteractiveFlight,
  onExportPreset,
  onImportPreset,
  scrubber,
  comparisonMode = "off",
  onToggleComparison,
}: FlightControlsProps) {
  // Top-level deck view switcher: All, Actions, Clips, Camera
  const [deckView, setDeckView] = useState<"all" | "actions" | "clips" | "camera">("all");

  // Navigation / Camera Sub-tab state
  const isOrthoPreset = cameraPreset.toLowerCase().includes("ortho");
  const [cameraSubTab, setCameraSubTab] = useState<"persp" | "ortho">(
    isOrthoPreset ? "ortho" : "persp"
  );
  // The sub-tab follows the active preset's family — showing "Perspective"
  // while the camera is orthographic is a false control label (doc 38 §3.7).
  useEffect(() => {
    setCameraSubTab(isOrthoPreset ? "ortho" : "persp");
  }, [isOrthoPreset]);

  // Clip drawer filter and search states
  const [clipCategory, setClipCategory] = useState<ClipCategory>("all");
  const [clipSearch, setClipSearch] = useState("");

  const filteredClips = useMemo(() => {
    return filterClips(clipDetails, clipCategory, clipSearch);
  }, [clipDetails, clipCategory, clipSearch]);

  const [activeOneShotName, setActiveOneShotName] = useState<string | null>(null);
  const oneShotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Never leave a flash timer pending past unmount
  useEffect(() => {
    return () => {
      if (oneShotTimerRef.current !== null) clearTimeout(oneShotTimerRef.current);
    };
  }, []);

  const handleActionClick = (actionName: string) => {
    setActiveOneShotName(actionName);
    onTriggerOneShot(actionName);
    if (oneShotTimerRef.current !== null) clearTimeout(oneShotTimerRef.current);
    oneShotTimerRef.current = setTimeout(() => {
      setActiveOneShotName(null);
      oneShotTimerRef.current = null;
    }, 1800);
  };

  return (
    <aside
      id="controls-panel"
      ref={panelRef}
      className={styles.controls}
      aria-label="Flight controls cockpit"
      tabIndex={-1}
    >
      {/* 0. Deck Switcher Tabs for Focused Inspection.
          Filter buttons, not tabs: they show/hide sections rather than swap
          panels, so aria-pressed is the honest pattern (doc 38 §4.5). */}
      <div className={styles.deckTabsBar} role="group" aria-label="Flight cockpit deck tabs">
        <button
          type="button"
          className={styles.deckTabBtn}
          data-active={deckView === "all"}
          aria-pressed={deckView === "all"}
          onClick={() => setDeckView("all")}
        >
          All
        </button>
        <button
          type="button"
          className={styles.deckTabBtn}
          data-active={deckView === "actions"}
          aria-pressed={deckView === "actions"}
          onClick={() => setDeckView("actions")}
        >
          Actions
        </button>
        <button
          type="button"
          className={styles.deckTabBtn}
          data-active={deckView === "clips"}
          aria-pressed={deckView === "clips"}
          onClick={() => setDeckView("clips")}
        >
          Clips ({clipDetails.length})
        </button>
        <button
          type="button"
          className={styles.deckTabBtn}
          data-active={deckView === "camera"}
          aria-pressed={deckView === "camera"}
          onClick={() => setDeckView("camera")}
        >
          Camera
        </button>
      </div>

      {/* 1. Precision Transport & Timeline Deck (Hero Position) */}
      <TimelineScrubber
        {...scrubber}
        paused={paused}
        onTogglePaused={onTogglePaused}
        speed={speed}
        onSpeedChange={onSpeedChange}
      />

      {/* 2. Quick Actions (Walk, Idle, Rest, Hover, Scout, Glide, Dive) */}
      {(deckView === "all" || deckView === "actions") && (
        <div className={styles.deckSection}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>Quick Actions</span>
            <span className={styles.sectionBadge}>HOTKEYS W, I, R…</span>
          </div>
          <div className={styles.quickActionGrid} aria-label="Quick locomotion and maneuver actions">
            {QUICK_LOCOMOTION_ACTIONS.map((item) => {
              const lowerActive = activeClip.toLowerCase();
              const lowerClip = item.clipName.toLowerCase();
              const isActive =
                lowerActive === lowerClip ||
                (lowerClip === "walk" && lowerActive === "groundwalk") ||
                (lowerClip === "cruise" && lowerActive === "flightcruise") ||
                (lowerClip === "idle" && lowerActive === "idle");
              return (
                <button
                  key={item.name}
                  type="button"
                  className={styles.quickActionBtn}
                  data-active={isActive}
                  disabled={specimenKind === "egg" || !hasClips}
                  onClick={() => onSelectClip(item.clipName)}
                  title={`${item.description} (Press ${item.key})`}
                >
                  <div className={styles.quickActionHeader}>
                    <kbd>{item.key}</kbd>
                    <span className={styles.quickActionIcon} aria-hidden="true">
                      {item.icon}
                    </span>
                  </div>
                  <span className={styles.quickActionLabel}>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 3. Aerodynamic Flight States */}
      {(deckView === "all" || deckView === "actions") && (
        <div className={styles.deckSection}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>
              {specimenKind === "egg" ? "Incubation specimen" : "Aerodynamic Flight States"}
            </span>
            <span className={styles.sectionBadge}>
              MODE: {mode.toUpperCase()}
            </span>
          </div>
          <div className={styles.modeGrid}>
            {MODES_UI.map((item) => {
              const isActive = mode === item.name;
              const capability = modeCapabilities?.[item.name as FlightLabMode];
              // `exact` is the authored clip, so it needs no badge. Everything
              // else is a substitution the button has to admit: on the V1 asset
              // cruise/bank/land have no clip at all and used to play silently.
              const substitution =
                capability && capability.status !== "exact"
                  ? capability.status === "alias"
                    ? "ALIAS"
                    : capability.status === "fallback"
                    ? "FALLBACK"
                    : "N/A"
                  : null;
              const isSuggested =
                (mode === "ground" && item.name === "takeoff") ||
                (mode !== "ground" && mode !== "takeoff" && mode !== "land" && item.name === "land");
              const isTransitioning =
                (mode === "takeoff" && item.name === "takeoff") ||
                (mode === "land" && item.name === "land");

              return (
                <button
                  key={item.name}
                  type="button"
                  className={styles.modeBtn}
                  disabled={specimenKind === "egg" || capability?.status === "unavailable"}
                  data-active={isActive}
                  data-suggested={isSuggested}
                  data-transitioning={isTransitioning}
                  data-capability={capability?.status}
                  aria-pressed={isActive}
                  onClick={() => onSelectMode(item.name as FlightLabMode)}
                  title={
                    item.name === "takeoff"
                      ? "Launch from ground into climb & cruise (Press 2)"
                      : item.name === "land"
                      ? "Approach, air-brake flare, and touchdown (Press 7)"
                      : `Set flight mode to ${item.label} (Press ${item.key})`
                  }
                >
                  <kbd>{item.key}</kbd>
                  <span className={styles.modeLabel}>{item.label}</span>
                  {substitution && (
                    <span
                      className={styles.modeCapabilityBadge}
                      data-status={capability?.status}
                      title={
                        capability?.status === "unavailable"
                          ? `No clip on this specimen can play mode "${item.name}"`
                          : `No authored "${item.name}" clip — plays "${capability?.clipName}". ${capability?.reason ?? ""}`
                      }
                    >
                      {substitution}
                    </span>
                  )}
                  {isSuggested && !isActive && (
                    <span className={styles.modeSuggestedBadge} title="Recommended transition">
                      {item.name === "takeoff" ? "▲ Launch" : "▼ Land"}
                    </span>
                  )}
                  {isTransitioning && (
                    <span className={styles.modeTransitionBadge}>
                      {item.name === "takeoff" ? "Climbing…" : "Landing…"}
                    </span>
                  )}
                  {isActive && <span className={styles.modeGlowIndicator} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. Kinetic Combat & Reactions */}
      {(deckView === "all" || deckView === "actions") && (
        <div className={styles.deckSection}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>Kinetic Combat & Reactions</span>
            <span className={styles.sectionMeta}>ONE-SHOT TRIGGER</span>
          </div>
          <div className={styles.actionGrid} aria-label="One-shot combat and reaction actions">
            {ONE_SHOTS_UI.map((action) => {
              const isExecuting = activeOneShotName === action.name;
              const isDeath = action.name === "death";
              return (
                <button
                  key={action.name}
                  type="button"
                  className={styles.actionBtn}
                  data-executing={isExecuting}
                  data-death={isDeath}
                  disabled={specimenKind === "egg" || !hasClips}
                  onClick={() => handleActionClick(action.name)}
                  title={`Play one-shot ${action.label} (${action.key})${isDeath ? " — clamps on completion" : " — returns to mode"}`}
                >
                  <div className={styles.actionHeader}>
                    <kbd>{action.key}</kbd>
                    {isExecuting && <span className={styles.pulseDot} />}
                  </div>
                  <span>{action.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. Spatial Camera & Optics Suite */}
      {(deckView === "all" || deckView === "camera") && (
        <div className={styles.deckSection}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>Spatial Camera & Optics</span>
            <div className={styles.cameraSubNav}>
              <button
                type="button"
                className={styles.cameraSubTabBtn}
                data-active={cameraSubTab === "persp"}
                onClick={() => setCameraSubTab("persp")}
              >
                Perspective
              </button>
              <button
                type="button"
                className={styles.cameraSubTabBtn}
                data-active={cameraSubTab === "ortho"}
                onClick={() => setCameraSubTab("ortho")}
              >
                Matched Ortho
              </button>
            </div>
          </div>

          {/* Angle Presets Grid */}
          <div className={styles.cameraPresetsGrid}>
            {cameraSubTab === "persp" ? (
              PERSP_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={styles.cameraPresetBtn}
                  data-active={cameraPreset === preset.id}
                  aria-pressed={cameraPreset === preset.id}
                  onClick={() => onSelectCameraPreset(preset.id)}
                >
                  <span className={styles.cameraPresetIcon} aria-hidden="true">
                    {preset.icon}
                  </span>
                  <span>{preset.label}</span>
                </button>
              ))
            ) : (
              ORTHO_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={styles.cameraPresetBtn}
                  data-active={cameraPreset === preset.id}
                  aria-pressed={cameraPreset === preset.id}
                  onClick={() => onSelectCameraPreset(preset.id)}
                  title={`${preset.label} orthographic view for matched Blender comparison`}
                >
                  <span className={styles.cameraPresetIcon} aria-hidden="true">
                    {preset.icon}
                  </span>
                  <span>{preset.label}</span>
                </button>
              ))
            )}
          </div>

          {/* Framing & Orbit Toolbar */}
          <div className={styles.cameraActionsRow}>
            {onZoomBy && (
              <div className={styles.zoomControlGroup}>
                <button
                  type="button"
                  className={styles.zoomBtn}
                  onClick={() => onZoomBy(-2)}
                  title="Zoom in"
                  aria-label="Zoom in"
                >
                  +
                </button>
                <span className={styles.zoomDistanceReadout}>
                  {cameraDistance < 10 ? cameraDistance.toFixed(1) : Math.round(cameraDistance)}
                  <small>{isOrthoPreset ? "vu" : "m"}</small>
                </span>
                <button
                  type="button"
                  className={styles.zoomBtn}
                  onClick={() => onZoomBy(2)}
                  title="Zoom out"
                  aria-label="Zoom out"
                >
                  −
                </button>
              </div>
            )}

            <button
              type="button"
              className={styles.cameraActionBtn}
              onClick={onResetCamera}
              title="Reset camera to default Chase view"
            >
              Reset
            </button>

            {onFitCamera && (
              <button
                type="button"
                className={styles.cameraActionBtn}
                onClick={onFitCamera}
                title="Fit camera view to specimen envelope"
              >
                Fit
              </button>
            )}

            {onToggleAutoOrbit && (
              <button
                type="button"
                className={styles.cameraActionBtn}
                data-active={autoOrbit}
                onClick={onToggleAutoOrbit}
                title="Toggle 360° turntable orbit"
              >
                Orbit
              </button>
            )}
          </div>
        </div>
      )}

      {/* 6. Smart Authored Clip Inspector */}
      {(deckView === "all" || deckView === "clips") && (
        <div className={styles.deckSection}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionLabel}>Authored Animation Clips</span>
            <span className={styles.sectionBadge}>
              {clipDetails.length} CLIPS
            </span>
          </div>

          {/* Clip Category Filter Pills */}
          <div className={styles.clipFilterTabs} role="group" aria-label="Clip category filters">
            {CLIP_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={styles.clipCategoryPill}
                data-active={clipCategory === cat.id}
                aria-pressed={clipCategory === cat.id}
                onClick={() => setClipCategory(cat.id)}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Quick Search */}
          <div className={styles.clipSearchRow}>
            <input
              type="search"
              className={styles.clipSearchInput}
              placeholder="Filter clips by name..."
              value={clipSearch}
              onChange={(e) => setClipSearch(e.target.value)}
              aria-label="Search animation clips"
            />
            {clipSearch && (
              <button
                type="button"
                className={styles.clipSearchClear}
                onClick={() => setClipSearch("")}
                aria-label="Clear clip search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Clips Grid */}
          <div
            className={styles.clipsList}
            data-view={deckView}
            aria-label="Available animation clips"
          >
            {filteredClips.length > 0 ? (
              filteredClips.map((clip) => {
                const isActive = activeClip.toLowerCase() === clip.name.toLowerCase();
                const category = categorizeClip(clip.name);
                return (
                  <button
                    key={clip.name}
                    type="button"
                    className={styles.clipCard}
                    data-active={isActive}
                    onClick={() => onSelectClip(clip.name)}
                    title={`Play ${clip.name} (${clip.duration.toFixed(2)}s, ${clip.tracksCount} tracks, category: ${category})`}
                  >
                    {isActive && <div className={styles.clipCardActiveIndicator} />}
                    <div className={styles.clipCardLeft}>
                      <div className={styles.clipCardHeader}>
                        <span className={styles.clipCardName}>{clip.name}</span>
                        <span
                          className={styles.clipCardCategoryBadge}
                          data-category={category}
                        >
                          {category}
                        </span>
                      </div>
                      <div className={styles.clipCardSub}>
                        <span className={styles.clipCardFrames}>{Math.round(clip.duration * 24)}f</span>
                        <span>•</span>
                        <span className={styles.clipCardTracks}>{clip.tracksCount} tracks</span>
                      </div>
                    </div>
                    <div className={styles.clipCardRight}>
                      <span className={styles.clipCardDuration}>{clip.duration.toFixed(2)}s</span>
                      {isActive ? (
                        <span className={styles.clipCardPlayingBadge}>
                          <span className={styles.pulseDot} style={{ width: 4, height: 4 }} />
                          ACTIVE
                        </span>
                      ) : (
                        <span className={styles.clipCardPlayHint}>PLAY ⇢</span>
                      )}
                    </div>
                  </button>
                );
              })
            ) : (
              <div className={styles.staticNotice}>
                {clipDetails.length === 0
                  ? "Static specimen — 0 animation clips"
                  : `No clips found matching "${clipSearch}" in ${clipCategory}`}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. Testing, Interactive Flight & Presets */}
      <div className={styles.deckSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>Testing & Presets</span>
        </div>
        <div className={styles.controlRow}>
          {onToggleInteractiveFlight && (
            <button
              type="button"
              className={interactiveFlightActive ? styles.activeFlightBtn : styles.flightBtn}
              onClick={onToggleInteractiveFlight}
              title="Toggle interactive keyboard flight navigation"
            >
              <span className={styles.flightIcon} aria-hidden="true">
                {interactiveFlightActive ? "✕" : "✈"}
              </span>
              <span>{interactiveFlightActive ? "Exit Flight" : "Interactive Flight"}</span>
            </button>
          )}

          {onExportPreset && (
            <button
              type="button"
              className={styles.presetExportBtn}
              onClick={onExportPreset}
              title="Save inspection configuration as JSON preset"
            >
              Save Preset
            </button>
          )}
        </div>
      </div>

      {/* 7. Comparison Matrix */}
      <ComparisonMatrixCard
        comparisonMode={comparisonMode}
        onToggleComparison={onToggleComparison}
      />

      {/* 8. Diagnostics Logs */}
      {children}
    </aside>
  );
}
