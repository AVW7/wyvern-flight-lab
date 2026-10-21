"use client";

import type { FlightLabHoverLandmark } from "../../../flight-lab/runtime";
import styles from "../FlightLabClient.module.css";

interface HoverLandmarkTooltipProps {
  landmark: FlightLabHoverLandmark;
}

export function HoverLandmarkTooltip({ landmark }: HoverLandmarkTooltipProps) {
  return (
    <div className={styles.hoverLandmarkCard} aria-live="polite">
      <div className={styles.hoverCardHeader}>
        <span className={styles.hoverCategoryBadge}>
          {landmark.id.replace(/_/g, " ").toUpperCase()}
        </span>
        <code className={styles.hoverBoneCode}>{landmark.boneName}</code>
      </div>
      <strong className={styles.hoverLandmarkLabel}>{landmark.label}</strong>
      <div className={styles.hoverCoordsRow}>
        <span>
          World: ({landmark.worldPos.x}, {landmark.worldPos.y}, {landmark.worldPos.z})
        </span>
        <span>
          Rot: ({landmark.rotDeg.x}°, {landmark.rotDeg.y}°, {landmark.rotDeg.z}°)
        </span>
        {landmark.parentBoneName && (
          <span>
            Parent: <code>{landmark.parentBoneName}</code>
          </span>
        )}
      </div>
      <div className={styles.hoverCardHint}>⚡ Click anywhere to Ping & drop AI Inspection Pin</div>
    </div>
  );
}
