"""Procedural animation math: periodic harmonic oscillators and cadence calculations.

Pure Python without `bpy` dependencies so it can be tested in Node / pytest CI.
"""

from __future__ import annotations

import math
from typing import Sequence, Tuple


def wave(cycles: int, phase: float, frame_t: float, skew: float = 0.0) -> float:
    """Evaluate one exactly-periodic harmonic, optionally phase-warped.

    `frame_t` is normalized time in [0, 1].
    `skew` bends the sine so the rise is quicker than the fall (useful for natural breathing).
    Because skew is applied inside the argument, the function remains exactly 2*pi periodic.
    """
    theta = 2.0 * math.pi * cycles * frame_t + phase
    if skew != 0.0:
        theta = theta + skew * math.sin(theta)
    return math.sin(theta)


def evaluate_harmonic_track(
    base_val: float,
    harmonics: Sequence[Tuple[int, float, float]],
    frame: int,
    period: int,
    skew: float = 0.0,
) -> float:
    """Evaluate a track defined by a static offset plus (cycles, amplitude, phase) harmonics."""
    if period <= 0:
        return base_val
    frame_t = (frame % period) / float(period)
    val = base_val
    for cycles, amp, phase in harmonics:
        val += amp * wave(cycles, phase, frame_t, skew)
    return val


def cadence_hz(beats: int, duration_s: float) -> float:
    """Calculate wingbeat cadence in Hz."""
    if duration_s <= 0:
        return 0.0
    return beats / duration_s


def cadence_from_frames(beats: int, frames: int, fps: float = 24.0) -> float:
    """Calculate wingbeat cadence in Hz given frame count."""
    if frames <= 0 or fps <= 0:
        return 0.0
    duration_s = frames / fps
    return beats / duration_s
