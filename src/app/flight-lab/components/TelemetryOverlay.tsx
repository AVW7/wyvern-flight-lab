"use client";

import type { FlightLabTelemetry } from "../../../flight-lab/runtime";
import styles from "../FlightLabClient.module.css";

interface TelemetryOverlayProps {
  telemetry: FlightLabTelemetry;
}

export function TelemetryOverlay({ telemetry }: TelemetryOverlayProps) {
  const iflight = telemetry.interactiveFlight;

  if (iflight?.active) {
    return (
      <div className={styles.telemetry} aria-label="Interactive flight telemetry">
        <div>
          <span>Airspeed</span>
          <strong>
            {iflight.airspeedMps}
            <small> m/s</small>
          </strong>
        </div>
        <div>
          <span>Altitude</span>
          <strong>
            {iflight.altitudeM}
            <small> m</small>
          </strong>
        </div>
        <div>
          <span>Climb Rate</span>
          <strong>
            {iflight.verticalSpeedMps > 0 ? "+" : ""}
            {iflight.verticalSpeedMps}
            <small> m/s</small>
          </strong>
        </div>
        <div>
          <span>Bank</span>
          <strong>
            {iflight.bankDeg > 0 ? "+" : ""}
            {iflight.bankDeg}
            <small>°</small>
          </strong>
        </div>
        <div>
          <span>G-Force</span>
          <strong>
            {iflight.gForce}
            <small> G</small>
          </strong>
        </div>
        <div>
          <span>Course Rings</span>
          <strong>
            {iflight.ringsCleared} / {iflight.courseRingCount}
          </strong>
        </div>
      </div>
    );
  }

  const strokePhase = telemetry.strokePhase ?? "glide";
  const symmetryScore = telemetry.symmetryScorePercent ?? 100;
  const symmetryMm = telemetry.symmetryDeltaMm ?? 0;

  return (
    <div className={styles.telemetry} aria-label="Flight telemetry">
      <div>
        <span>Airspeed</span>
        <strong>
          {telemetry.speed}
          <small> km/h (sim)</small>
        </strong>
      </div>
      <div>
        <span>Altitude</span>
        <strong>
          {telemetry.altitude}
          <small> m (sim)</small>
        </strong>
      </div>
      <div>
        <span>Bank</span>
        <strong>
          {telemetry.bank > 0 ? "+" : ""}
          {telemetry.bank}
          <small>°</small>
        </strong>
      </div>
      <div>
        <span>Stroke</span>
        <strong className={styles.strokeBadge} data-phase={strokePhase}>
          {strokePhase.toUpperCase()}
        </strong>
      </div>
      <div>
        <span>Symmetry</span>
        <strong title={`Bilateral tip height delta: ${symmetryMm}mm`}>
          {symmetryScore}%
          <small> ({symmetryMm}mm)</small>
        </strong>
      </div>
    </div>
  );
}
