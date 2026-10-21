"use client";

import type { FlightLabPin } from "../../../flight-lab/runtime";
import styles from "../FlightLabClient.module.css";

interface ActivePinBannerProps {
  pin: FlightLabPin;
  pinCount?: number;
  copiedPin: boolean;
  onCopyActivePin: () => void;
  onClearPins: () => void;
}

export function ActivePinBanner({
  pin,
  pinCount = 1,
  copiedPin,
  onCopyActivePin,
  onClearPins,
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
