"use client";

import { useCallback, useRef, useState } from "react";
import type { FlightLabTelemetry } from "../../../flight-lab/runtime";
import { formatBubbleTime, formatTimecode } from "../../../flight-lab/controlHelpers";
import styles from "../FlightLabClient.module.css";

export interface TimelineScrubberProps {
  telemetry: FlightLabTelemetry;
  isScrubbing: boolean;
  scrubTime: number;
  isLooping: boolean;
  onScrubStart: () => void;
  onScrubEnd: () => void;
  onScrubChange: (val: number) => void;
  onStepFrames: (delta: number) => void;
  onToggleLoop: () => void;
  onSetInspectionFps: (fps: number) => void;
  paused?: boolean;
  onTogglePaused?: () => void;
  speed?: number;
  onSpeedChange?: (speed: number) => void;
}

export function TimelineScrubber({
  telemetry,
  isScrubbing,
  scrubTime,
  isLooping,
  onScrubStart,
  onScrubEnd,
  onScrubChange,
  onStepFrames,
  onToggleLoop,
  onSetInspectionFps,
  paused,
  onTogglePaused,
  speed,
  onSpeedChange,
}: TimelineScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isPointerDragging, setIsPointerDragging] = useState(false);
  const [hoverPosition, setHoverPosition] = useState<{ fraction: number; time: number } | null>(null);

  const duration = telemetry.clipDuration || 0;
  const currentTime = isScrubbing ? scrubTime : telemetry.clipTime;
  const progressPercent = duration > 0 ? Math.min(Math.max((currentTime / duration) * 100, 0), 100) : 0;
  const fps = telemetry.inspectionFps || 24;

  const getTimeFromPointer = useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track || duration <= 0) return 0;
      const rect = track.getBoundingClientRect();
      const fraction = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      return fraction * duration;
    },
    [duration]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const track = trackRef.current;
    if (!track) return;
    track.setPointerCapture(e.pointerId);
    setIsPointerDragging(true);
    onScrubStart();
    const newTime = getTimeFromPointer(e.clientX);
    onScrubChange(newTime);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const fraction = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
    const hoverTime = fraction * duration;
    setHoverPosition({ fraction, time: hoverTime });

    if (isPointerDragging) {
      const newTime = getTimeFromPointer(e.clientX);
      onScrubChange(newTime);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPointerDragging) {
      const track = trackRef.current;
      if (track && track.hasPointerCapture(e.pointerId)) {
        track.releasePointerCapture(e.pointerId);
      }
      setIsPointerDragging(false);
      onScrubEnd();
    }
  };

  const handlePointerLeave = () => {
    if (!isPointerDragging) {
      setHoverPosition(null);
    }
  };

  const bubbleFraction = isPointerDragging
    ? progressPercent / 100
    : hoverPosition?.fraction ?? progressPercent / 100;

  const bubbleTime = isPointerDragging
    ? currentTime
    : hoverPosition?.time ?? currentTime;

  const isPlaying = !paused && telemetry.isPlaying;

  return (
    <div className={styles.animationTelemetry}>
      {/* Header with Title and Status Badges */}
      <div className={styles.animHeader}>
        <div className={styles.animHeaderLeft}>
          <span className={styles.animTitle}>Precision Transport</span>
          <span className={styles.stateBadge} data-playing={isPlaying}>
            <i />
            {isPlaying ? "PLAYING" : "PAUSED"}
          </span>
        </div>
        <div className={styles.animBadges}>
          <span
            className={styles.speedBadge}
            title={`Playback rate scale: ${telemetry.speedScale.toFixed(2)}x${telemetry.effectiveRate !== telemetry.speedScale ? ` · Effective: ${telemetry.effectiveRate.toFixed(2)}x` : ""}`}
          >
            {(telemetry.effectiveRate ?? telemetry.speedScale).toFixed(2)}×
            {telemetry.effectiveRate !== telemetry.speedScale ? " BOOST" : ""}
          </span>
        </div>
      </div>

      {/* Active Clip Name and Detailed Timecode */}
      <div className={styles.animClipRow}>
        <strong className={styles.animClipName} title={telemetry.clip}>
          {telemetry.clip}
        </strong>
        <span className={styles.animTime}>
          {duration > 0
            ? formatTimecode(currentTime, duration, fps)
            : "Static pose (0 tracks)"}
        </span>
      </div>

      {/* Direct-Manipulation Scrubbing Track with Floating Tooltip Bubble */}
      <div
        className={styles.scrubberContainer}
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        role="slider"
        aria-label="Seek animation time"
        aria-valuemin={0}
        aria-valuemax={duration || 1}
        aria-valuenow={currentTime}
        aria-valuetext={`${currentTime.toFixed(2)} seconds`}
        tabIndex={duration > 0 ? 0 : -1}
      >
        {/* Floating Timecode Bubble */}
        {(hoverPosition || isPointerDragging) && duration > 0 && (
          <div
            className={styles.scrubberBubble}
            style={{ left: `${Math.min(Math.max(bubbleFraction * 100, 4), 96)}%` }}
            aria-hidden="true"
          >
            {formatBubbleTime(bubbleTime, fps)}
          </div>
        )}

        <div className={styles.scrubberTrack}>
          <div
            className={styles.scrubberFill}
            style={{ width: `${progressPercent}%` }}
          />
          <div
            className={styles.scrubberThumb}
            style={{ left: `${progressPercent}%` }}
            data-dragging={isPointerDragging}
          />
        </div>
      </div>

      {/* Transport Controls Bar: Play/Pause, -1f, +1f, Loop */}
      <div className={styles.timelineControlRow}>
        {onTogglePaused && (
          <button
            type="button"
            className={styles.transportPlayBtn}
            onClick={onTogglePaused}
            disabled={!duration}
            title={isPlaying ? "Pause animation (Space)" : "Resume playback (Space)"}
          >
            <span className={styles.playIcon} aria-hidden="true">
              {isPlaying ? "❚❚" : "▶"}
            </span>
            <span>{isPlaying ? "Pause" : "Play"}</span>
            <kbd>Space</kbd>
          </button>
        )}

        <div className={styles.frameStepButtons}>
          <button
            type="button"
            className={styles.stepBtn}
            onClick={() => onStepFrames(-1)}
            disabled={!duration}
            title="Step backward 1 frame ([ or Left Arrow)"
          >
            −1f
            <kbd>[</kbd>
          </button>
          <button
            type="button"
            className={styles.stepBtn}
            onClick={() => onStepFrames(1)}
            disabled={!duration}
            title="Step forward 1 frame (] or Right Arrow)"
          >
            +1f
            <kbd>]</kbd>
          </button>
        </div>

        <button
          type="button"
          className={styles.loopBtn}
          data-looping={isLooping}
          onClick={onToggleLoop}
          disabled={!duration}
          title="Toggle playback loop mode"
        >
          {isLooping ? "Loop: On" : "Once"}
        </button>
      </div>

      {/* Inspection Frame-Rate & Speed Selector */}
      <div className={styles.transportFooter}>
        <div className={styles.fpsRow}>
          <span>Inspect Rate</span>
          <div className={styles.fpsButtons}>
            {([12, 24, 30, 60] as const).map((rate) => (
              <button
                key={rate}
                type="button"
                data-active={fps === rate}
                aria-pressed={fps === rate}
                onClick={() => onSetInspectionFps(rate)}
                disabled={!duration}
                title={`Set inspection frame-step to ${rate} fps`}
              >
                {rate}
              </button>
            ))}
            <span className={styles.fpsLabel}>fps</span>
          </div>
        </div>

        {speed !== undefined && onSpeedChange && (
          <div className={styles.speedRow}>
            <span>Rate <output>{speed.toFixed(2)}×</output></span>
            <input
              type="range"
              min="0.25"
              max="2"
              step="0.05"
              value={speed}
              disabled={!duration}
              onChange={(e) => onSpeedChange(Number(e.target.value))}
              aria-label="Playback speed scale"
            />
          </div>
        )}
      </div>
    </div>
  );
}
