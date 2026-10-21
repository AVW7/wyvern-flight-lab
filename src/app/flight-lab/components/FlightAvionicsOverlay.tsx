"use client";

import type { FlightLabTelemetry } from "../../../flight-lab/runtime";
import styles from "../FlightLabClient.module.css";

export interface FlightKeyStates {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  climb: boolean;
  dive: boolean;
  boost: boolean;
}

interface FlightAvionicsOverlayProps {
  keyStates: FlightKeyStates;
  telemetry: FlightLabTelemetry;
  onExit: () => void;
}

export function FlightAvionicsOverlay({
  keyStates,
  telemetry,
  onExit,
}: FlightAvionicsOverlayProps) {
  const iflight = telemetry.interactiveFlight;
  const bankDeg = iflight?.bankDeg ?? 0;
  const pitchDeg = iflight?.pitchDeg ?? 0;
  const airspeed = iflight?.airspeedMps ?? 0;
  const altitude = iflight?.altitudeM ?? 0;
  const ringsCleared = iflight?.ringsCleared ?? 0;
  const totalRings = iflight?.courseRingCount ?? 6;

  return (
    <div className={styles.avionicsContainer} aria-label="Interactive flight avionics deck">
      {/* Top Banner: Flight Mode Indicator & Exit Pill */}
      <div className={styles.avionicsTopBar}>
        <div className={styles.avionicsStatusBadge}>
          <span className={styles.avionicsPulseDot} />
          <span>AVIONICS FLIGHT ACTIVE</span>
        </div>
        <button
          type="button"
          className={styles.avionicsExitBtn}
          onClick={onExit}
          title="Exit Interactive Flight (Escape)"
        >
          Exit Flight <kbd>ESC</kbd>
        </button>
      </div>

      {/* Central Attitude & Pitch Gauge */}
      <div className={styles.attitudeGauge} aria-label="Attitude indicator">
        <div
          className={styles.attitudeHorizon}
          style={{
            transform: `rotate(${-bankDeg}deg) translateY(${Math.min(Math.max(pitchDeg * 1.5, -20), 20)}px)`,
          }}
        >
          <div className={styles.horizonSky} />
          <div className={styles.horizonLine} />
          <div className={styles.horizonGround} />
        </div>
        <div className={styles.attitudeReticle}>
          <span className={styles.attitudeWingLeft} />
          <span className={styles.attitudeDot} />
          <span className={styles.attitudeWingRight} />
        </div>
        <div className={styles.attitudeReadout}>
          <span>BANK {bankDeg > 0 ? `+${bankDeg}` : bankDeg}°</span>
          <span>PITCH {pitchDeg > 0 ? `+${pitchDeg}` : pitchDeg}°</span>
        </div>
      </div>

      {/* Flight Course Ring Progress Gauge */}
      <div className={styles.ringsGauge}>
        <div className={styles.ringsLabel}>
          <span>FLIGHT COURSE</span>
          <strong>
            {ringsCleared} / {totalRings} RINGS
          </strong>
        </div>
        <div className={styles.ringsPips}>
          {Array.from({ length: totalRings }).map((_, i) => (
            <span
              key={i}
              className={styles.ringPip}
              data-cleared={i < ringsCleared}
            />
          ))}
        </div>
      </div>

      {/* Interactive Key Controller Deck */}
      <div className={styles.keyDeck} aria-label="Live flight controls feedback">
        <div className={styles.keyDeckTitle}>ACTIVE FLIGHT CONTROLS</div>
        <div className={styles.keyGrid}>
          {/* Pitch & Roll Cluster */}
          <div className={styles.keyCluster}>
            <div className={styles.keyRowTop}>
              <div
                className={styles.keyBadge}
                data-pressed={keyStates.forward}
                title="Forward Pitch Down (W / Up Arrow)"
              >
                <kbd>W</kbd>
                <span>Pitch −</span>
              </div>
            </div>
            <div className={styles.keyRowBottom}>
              <div
                className={styles.keyBadge}
                data-pressed={keyStates.left}
                title="Bank Left (A / Left Arrow)"
              >
                <kbd>A</kbd>
                <span>Roll L</span>
              </div>
              <div
                className={styles.keyBadge}
                data-pressed={keyStates.backward}
                title="Backward Pitch Up (S / Down Arrow)"
              >
                <kbd>S</kbd>
                <span>Pitch +</span>
              </div>
              <div
                className={styles.keyBadge}
                data-pressed={keyStates.right}
                title="Bank Right (D / Right Arrow)"
              >
                <kbd>D</kbd>
                <span>Roll R</span>
              </div>
            </div>
          </div>

          {/* Kinetic Vertical & Boost Cluster */}
          <div className={styles.keyClusterVertical}>
            <div
              className={styles.keyBadgeAction}
              data-pressed={keyStates.climb}
              title="Climb / Flap Wings (Space / R)"
            >
              <kbd>SPACE</kbd>
              <span>Climb Lift</span>
            </div>
            <div className={styles.keyRowActions}>
              <div
                className={styles.keyBadgeSmall}
                data-pressed={keyStates.dive}
                title="Dive (C / F)"
              >
                <kbd>C</kbd>
                <span>Dive</span>
              </div>
              <div
                className={styles.keyBadgeSmall}
                data-pressed={keyStates.boost}
                title="Afterburner Boost (Shift)"
              >
                <kbd>SHIFT</kbd>
                <span>Boost</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
