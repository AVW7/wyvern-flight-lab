"use client";

import { useState } from "react";
import type { FlightLabComparisonMode } from "../../../flight-lab/runtime";
import styles from "../FlightLabClient.module.css";

interface ComparisonMatrixCardProps {
  comparisonMode?: FlightLabComparisonMode;
  onToggleComparison?: (mode: FlightLabComparisonMode) => void;
}

export function ComparisonMatrixCard({
  comparisonMode = "off",
  onToggleComparison,
}: ComparisonMatrixCardProps) {
  const [showMatrix, setShowMatrix] = useState(false);

  return (
    <div className={styles.comparisonCard}>
      <div className={styles.comparisonHeader}>
        <span>V1 vs V2 Rig Comparison</span>
        <button
          type="button"
          className={styles.matrixToggleBtn}
          onClick={() => setShowMatrix(!showMatrix)}
        >
          {showMatrix ? "Hide Matrix" : "View Matrix"}
        </button>
      </div>

      <div className={styles.compModeRow}>
        <span>Overlay mode:</span>
        <div className={styles.compButtons}>
          <button
            type="button"
            data-active={comparisonMode === "off"}
            onClick={() => onToggleComparison?.("off")}
          >
            Off
          </button>
          <button
            type="button"
            data-active={comparisonMode === "ghost"}
            onClick={() => onToggleComparison?.(comparisonMode === "ghost" ? "off" : "ghost")}
            title="Phantom holographic overlay aligned in normalized stroke phase"
          >
            Ghost
          </button>
          <button
            type="button"
            data-active={comparisonMode === "formation"}
            onClick={() => onToggleComparison?.(comparisonMode === "formation" ? "off" : "formation")}
            title="Side-by-side formation flight"
          >
            Formation
          </button>
        </div>
      </div>

      {showMatrix && (
        <div className={styles.matrixTable} role="table" aria-label="Rig specification matrix">
          <div className={styles.matrixRow} role="row">
            <span className={styles.matrixLabel} role="columnheader">
              Metric
            </span>
            <strong className={styles.matrixColV2} role="columnheader">
              V2 Rig (Gothic)
            </strong>
            <strong className={styles.matrixColV1} role="columnheader">
              V1 Rig (Drogon)
            </strong>
          </div>
          <div className={styles.matrixRow} role="row">
            <span className={styles.matrixLabel}>Triangles</span>
            <span className={styles.matrixColV2}>49,872</span>
            <span className={styles.matrixColV1}>39,234</span>
          </div>
          <div className={styles.matrixRow} role="row">
            <span className={styles.matrixLabel}>Rig Bones</span>
            <span className={styles.matrixColV2}>95 clean bones</span>
            <span className={styles.matrixColV1}>300 biped nodes</span>
          </div>
          <div className={styles.matrixRow} role="row">
            <span className={styles.matrixLabel}>Action Clips</span>
            <span className={styles.matrixColV2}>18 actions</span>
            <span className={styles.matrixColV1}>13 actions</span>
          </div>
          <div className={styles.matrixRow} role="row">
            <span className={styles.matrixLabel}>Wing Symmetry</span>
            <span className={styles.matrixColV2}>100.0% bilateral</span>
            <span className={styles.matrixColV1}>~91.4% biped</span>
          </div>
          <div className={styles.matrixRow} role="row">
            <span className={styles.matrixLabel}>Compression</span>
            <span className={styles.matrixColV2}>3.37 MB (meshopt)</span>
            <span className={styles.matrixColV1}>5.92 MB (raw)</span>
          </div>
          <div className={styles.matrixRow} role="row">
            <span className={styles.matrixLabel}>Bones Standard</span>
            <span className={styles.matrixColV2}>Canonical Wyvern</span>
            <span className={styles.matrixColV1}>3ds Max Biped</span>
          </div>
        </div>
      )}
    </div>
  );
}
