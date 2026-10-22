"use client";

import type { FlightLabPin } from "../../../flight-lab/runtime";
import styles from "../FlightLabClient.module.css";

interface ActivePinBannerProps {
  pin: FlightLabPin;
  pinCount?: number;
  copiedPin: boolean;
  savedPin?: boolean;
  onCopyActivePin: () => void;
  onSaveActivePin?: () => void;
  onClearPins: () => void;
  onUpdatePinNote?: (note: string) => void;
}

export function ActivePinBanner({
  pin,
  pinCount = 1,
  copiedPin,
  savedPin = false,
  onCopyActivePin,
  onSaveActivePin,
  onClearPins,
  onUpdatePinNote,
}: ActivePinBannerProps) {
  return (
    <div className={styles.pinBanner}>
      <div className={styles.pinDetails}>
        <span className={styles.pinNumberBadge}>PIN #{pin.index}</span>
        <strong>{pin.label}</strong>
        <code className={styles.pinBoneCode}>{pin.boneName}</code>
        <span className={styles.pinMetaTime}>
          @ {pin.clipTime}s ({Math.round(pin.clipProgress * 100)}% · {pin.strokePhase.toUpperCase()})
        </span>
      </div>
      <input
        type="text"
        className={styles.pinNoteInput}
        value={pin.note ?? ""}
        placeholder="Describe issue for AI (e.g. neck craned too high)…"
        aria-label="Describe issue for AI"
        onChange={(event) => onUpdatePinNote?.(event.target.value)}
      />
      <div className={styles.pinActions}>
        <button
          type="button"
          className={styles.pinCopyBtn}
          onClick={onCopyActivePin}
          title="Copy formatted prompt for AI"
        >
          {copiedPin ? "✓ Copied for AI" : "Copy for AI"}
        </button>
        <button
          type="button"
          className={styles.pinSaveBtn}
          data-saved={savedPin || undefined}
          onClick={onSaveActivePin}
          disabled={!onSaveActivePin}
          title="Write this ticket + the current screenshot to docs/flight-lab/inbox/latest-issue.md"
        >
          {savedPin ? "✓ Saved to repo" : "Save for AI"}
        </button>
        <button
          type="button"
          className={styles.pinClearBtn}
          onClick={onClearPins}
          title="Clear all inspection pins"
        >
          Clear Pins ({pinCount})
        </button>
      </div>
    </div>
  );
}
