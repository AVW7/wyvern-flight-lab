"use client";

import styles from "../FlightLabClient.module.css";

interface CameraZoomDockProps {
  isOrtho: boolean;
  cameraDistance: number;
  onZoomBy: (amount: number) => void;
}

function getZoomStep(distance: number, isOrtho: boolean): number {
  if (distance <= 4) {
    return isOrtho ? 0.4 : 0.8;
  }
  if (distance <= 8) {
    return isOrtho ? 0.8 : 1.5;
  }
  return 3;
}

function formatCameraDistance(distance: number): number {
  return distance < 10 ? Number(distance.toFixed(1)) : Math.round(distance);
}

export function CameraZoomDock({ isOrtho, cameraDistance, onZoomBy }: CameraZoomDockProps) {
  const zoomStep = getZoomStep(cameraDistance, isOrtho);
  const formattedDistance = formatCameraDistance(cameraDistance);

  return (
    <div className={styles.cameraDock} aria-label="Camera controls">
      <span className={styles.cameraModeLabel}>{isOrtho ? "ORTHO" : "PERSP"}</span>
      <button
        type="button"
        aria-label="Zoom in"
        title={`Zoom in (step ${zoomStep}${isOrtho ? "vu" : "m"}, or scroll)`}
        onClick={() => onZoomBy(-zoomStep)}
      >
        +
      </button>
      <span
        title={isOrtho ? "Orthographic view size" : "Camera distance"}
        style={{ minWidth: "3.8em", textAlign: "center" }}
      >
        <b>{formattedDistance}</b>
        <small>{isOrtho ? "\u00a0vu" : "\u00a0m"}</small>
      </span>
      <button
        type="button"
        aria-label="Zoom out"
        title={`Zoom out (step ${zoomStep}${isOrtho ? "vu" : "m"}, or scroll)`}
        onClick={() => onZoomBy(zoomStep)}
      >
        −
      </button>
    </div>
  );
}
