"use client";

import type { RefObject } from "react";
import type { FlightLabComparisonMode, FlightLabTelemetry } from "../../../flight-lab/runtime";
import styles from "../FlightLabClient.module.css";
import { ActivePinBanner } from "./ActivePinBanner";
import { CameraZoomDock } from "./CameraZoomDock";
import { FlightAvionicsOverlay, type FlightKeyStates } from "./FlightAvionicsOverlay";
import { HoverLandmarkTooltip } from "./HoverLandmarkTooltip";
import { TelemetryOverlay } from "./TelemetryOverlay";

function resolveStageStatus(
  loading: boolean,
  error: string | null,
  comparisonMode: FlightLabComparisonMode,
  interactiveFlight: boolean
): string {
  if (loading) return "CALIBRATING RIG";
  if (error) return "LOAD FAULT";
  if (interactiveFlight) return "MANUAL FLIGHT AVIONICS";
  if (comparisonMode === "ghost") return "GHOST COMPARISON";
  if (comparisonMode === "formation") return "FORMATION FLIGHT";
  return "RIG ONLINE";
}

interface StageToolItem {
  id: string;
  label: string;
  title: string;
  active?: boolean;
  group: "visual" | "compare" | "action";
  onClick: () => void;
}

interface StageViewportProps {
  viewportRef: RefObject<HTMLDivElement | null>;
  specimenName: string;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
  showSkeleton: boolean;
  onToggleSkeleton: () => void;
  showWireframe: boolean;
  onToggleWireframe: () => void;
  showSilhouette: boolean;
  onToggleSilhouette: () => void;
  showStreamlines: boolean;
  onToggleStreamlines: () => void;
  autoOrbit: boolean;
  onToggleAutoOrbit: () => void;
  floorVisible: boolean;
  onToggleFloor: () => void;
  showProbes: boolean;
  onToggleProbes: () => void;
  comparisonMode: FlightLabComparisonMode;
  onToggleComparison: (mode: FlightLabComparisonMode) => void;
  telemetry: FlightLabTelemetry;
  onCopyActivePin: () => void;
  copiedPin: boolean;
  onClearPins: () => void;
  onZoomBy: (amount: number) => void;
  onScanSeam: () => void;
  onExportEvidence: () => void;
  interactiveFlightActive?: boolean;
  onToggleInteractiveFlight?: () => void;
  flightKeyStates?: FlightKeyStates;
}

export function StageViewport({
  viewportRef,
  specimenName,
  loading,
  error,
  onRetry,
  showSkeleton,
  onToggleSkeleton,
  showWireframe,
  onToggleWireframe,
  showSilhouette,
  onToggleSilhouette,
  showStreamlines,
  onToggleStreamlines,
  autoOrbit,
  onToggleAutoOrbit,
  floorVisible,
  onToggleFloor,
  showProbes,
  onToggleProbes,
  comparisonMode,
  onToggleComparison,
  telemetry,
  onCopyActivePin,
  copiedPin,
  onClearPins,
  onZoomBy,
  onScanSeam,
  onExportEvidence,
  interactiveFlightActive = false,
  onToggleInteractiveFlight,
  flightKeyStates = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    climb: false,
    dive: false,
    boost: false,
  },
}: StageViewportProps) {
  const stageTools: StageToolItem[] = [
    // Visual Layer Overlays
    {
      id: "rig",
      label: "Rig",
      title: "Toggle Skeleton Armature Overlay",
      active: showSkeleton,
      group: "visual",
      onClick: onToggleSkeleton,
    },
    {
      id: "wire",
      label: "Wire",
      title: "Toggle Topology Wireframe Overlay",
      active: showWireframe,
      group: "visual",
      onClick: onToggleWireframe,
    },
    {
      id: "silh",
      label: "Silh",
      title: "Toggle High-Contrast Silhouette Mode",
      active: showSilhouette,
      group: "visual",
      onClick: onToggleSilhouette,
    },
    {
      id: "vortex",
      label: "Vortex",
      title: "Toggle Wingtip Vortex Streamlines",
      active: showStreamlines,
      group: "visual",
      onClick: onToggleStreamlines,
    },
    {
      id: "probes",
      label: "Probes",
      title: "Toggle 3D Anatomical Probes & Joint Markers (P)",
      active: showProbes,
      group: "visual",
      onClick: onToggleProbes,
    },
    {
      id: "floor",
      label: "Floor",
      title: "Toggle Visible Floor Reference Plane",
      active: floorVisible,
      group: "visual",
      onClick: onToggleFloor,
    },
    // Comparison Overlays
    {
      id: "ghost",
      label: "Ghost",
      title: "Toggle V1 vs V2 Translucent Ghost Overlay",
      active: comparisonMode === "ghost",
      group: "compare",
      onClick: () => onToggleComparison(comparisonMode === "ghost" ? "off" : "ghost"),
    },
    {
      id: "formation",
      label: "Formation",
      title: "Toggle V1 + V2 Side-by-Side Formation Flight",
      active: comparisonMode === "formation",
      group: "compare",
      onClick: () => onToggleComparison(comparisonMode === "formation" ? "off" : "formation"),
    },
    // Inspection & Export Actions
    {
      id: "scan",
      label: "Scan",
      title: "Scan active clip for seam jumps > 10°",
      group: "action",
      onClick: onScanSeam,
    },
    {
      id: "export",
      label: "Export",
      title: "Export PNG screenshot + JSON telemetry evidence",
      group: "action",
      onClick: onExportEvidence,
    },
  ];

  const visualTools = stageTools.filter((t) => t.group === "visual");
  const compareTools = stageTools.filter((t) => t.group === "compare");
  const actionTools = stageTools.filter((t) => t.group === "action");

  return (
    <div className={styles.stage}>
      {/* 3D WebGL Canvas Viewport */}
      <div
        ref={viewportRef}
        className={styles.viewport}
        aria-label={`Interactive flight preview of ${specimenName}`}
      />

      {/* Top Telemetry & Status Ribbon */}
      <div className={styles.stageTop}>
        <span className={styles.live}>
          <i /> LIVE SIMULATION
        </span>
        <span className={styles.stageStatusBadge}>
          {resolveStageStatus(loading, error, comparisonMode, interactiveFlightActive)}
        </span>
      </div>

      {/* Floating Glass Dynamic Island / Top Diagnostic Toolbar */}
      <div className={styles.stageToolbar} aria-label="Diagnostic overlays">
        <div className={styles.toolbarCluster}>
          {visualTools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className={styles.stageToolBtn}
              data-active={tool.active}
              aria-pressed={tool.active}
              onClick={tool.onClick}
              title={tool.title}
            >
              {tool.label}
            </button>
          ))}
        </div>

        <div className={styles.toolbarSeparator} aria-hidden="true" />

        <div className={styles.toolbarCluster}>
          {compareTools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className={styles.stageToolBtn}
              data-active={tool.active}
              aria-pressed={tool.active}
              onClick={tool.onClick}
              title={tool.title}
            >
              {tool.label}
            </button>
          ))}
        </div>

        <div className={styles.toolbarSeparator} aria-hidden="true" />

        <div className={styles.toolbarCluster}>
          {actionTools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className={styles.stageToolBtnAction}
              onClick={tool.onClick}
              title={tool.title}
            >
              {tool.label}
            </button>
          ))}
        </div>
      </div>

      {/* Load Error Alert */}
      {error && (
        <div className={styles.error} role="alert">
          <div>{error}</div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className={styles.retryBtn}
            >
              Retry Load
            </button>
          )}
        </div>
      )}

      {/* 3D Landmark Hover Card */}
      {telemetry.hoverLandmark && (
        <HoverLandmarkTooltip landmark={telemetry.hoverLandmark} />
      )}

      {/* Active Pin Top Banner */}
      {telemetry.activePin && (
        <ActivePinBanner
          pin={telemetry.activePin}
          pinCount={telemetry.pinCount ?? 1}
          copiedPin={copiedPin}
          onCopyActivePin={onCopyActivePin}
          onClearPins={onClearPins}
        />
      )}

      {/* Reticle Focus Anchor */}
      <div className={styles.reticle} aria-hidden="true">
        <span />
        <span />
      </div>

      {/* Floating Bottom Telemetry Overlay */}
      <TelemetryOverlay telemetry={telemetry} />

      {/* Floating Top-Right Camera Zoom Dock */}
      <CameraZoomDock
        isOrtho={telemetry.isOrtho}
        cameraDistance={telemetry.cameraDistance}
        onZoomBy={onZoomBy}
      />

      {/* Interactive Flight Avionics Cockpit HUD */}
      {interactiveFlightActive && onToggleInteractiveFlight && (
        <FlightAvionicsOverlay
          keyStates={flightKeyStates}
          telemetry={telemetry}
          onExit={onToggleInteractiveFlight}
        />
      )}

      <div className={styles.dragHint}>
        CLICK TO PING LANDMARK · DRAG ORBIT · SHIFT/RIGHT DRAG PAN · SCROLL ZOOM
      </div>
    </div>
  );
}
