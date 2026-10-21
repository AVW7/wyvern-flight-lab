"use client";

import type { Ref } from "react";
import styles from "../FlightLabClient.module.css";

export interface PanelToggleProps {
  side: "left" | "right";
  open: boolean;
  label: string;
  onToggle: () => void;
  /** id of the panel this button expands/collapses */
  controls: string;
  toggleRef?: Ref<HTMLButtonElement>;
}

/**
 * Hide/show arrow for a docked side panel. Sits on the panel's inner edge and
 * parks at the dock edge while the panel is hidden, at every breakpoint.
 */
export function PanelToggle({ side, open, label, onToggle, controls, toggleRef }: PanelToggleProps) {
  const direction = open ? side : side === "left" ? "right" : "left";
  const action = open ? "Hide" : "Show";
  return (
    <button
      type="button"
      ref={toggleRef}
      className={styles.panelToggle}
      data-side={side}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={`${action} ${label}`}
      title={`${action} ${label}`}
      onClick={onToggle}
    >
      <svg viewBox="0 0 8 12" width="8" height="12" aria-hidden="true" focusable="false">
        <path
          d={direction === "left" ? "M6.5 1 1.5 6l5 5" : "M1.5 1l5 5-5 5"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
