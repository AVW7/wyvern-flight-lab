import * as THREE from "three";

export interface FlightInputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  climb: boolean;
  dive: boolean;
  boost: boolean;
}

export interface InteractiveFlightTelemetry {
  active: boolean;
  airspeedMps: number;
  verticalSpeedMps: number;
  altitudeM: number;
  bankDeg: number;
  pitchDeg: number;
  headingDeg: number;
  gForce: number;
  courseRingCount: number;
  ringsCleared: number;
}

export interface FlightCourseRing {
  id: number;
  position: THREE.Vector3;
  radius: number;
  cleared: boolean;
}

export const COURSE_RINGS: readonly FlightCourseRing[] = [
  { id: 1, position: new THREE.Vector3(0, 4, -18), radius: 4.5, cleared: false },
  { id: 2, position: new THREE.Vector3(20, 9, -28), radius: 5.0, cleared: false },
  { id: 3, position: new THREE.Vector3(32, 14, 0), radius: 5.0, cleared: false },
  { id: 4, position: new THREE.Vector3(18, 10, 26), radius: 5.0, cleared: false },
  { id: 5, position: new THREE.Vector3(-18, 6, 22), radius: 4.5, cleared: false },
  { id: 6, position: new THREE.Vector3(-22, 4, -10), radius: 4.5, cleared: false },
];

export interface InteractiveFlightController {
  setActive(active: boolean): void;
  isActive(): boolean;
  setInput(input: Partial<FlightInputState>): void;
  reset(): void;
  tick(delta: number): void;
  getPosition(): THREE.Vector3;
  getRotation(): THREE.Euler;
  getTelemetry(): InteractiveFlightTelemetry;
  getRings(): FlightCourseRing[];
}

export function createInteractiveFlightController(
  initialPosition = new THREE.Vector3(0, 0, 0)
): InteractiveFlightController {
  let active = false;

  const position = initialPosition.clone();
  const velocity = new THREE.Vector3();
  let heading = 0;
  let pitch = 0;
  let roll = 0;
  let currentSpeed = 14.0;
  let currentVerticalSpeed = 0;
  let gForce = 1.0;

  const input: FlightInputState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    climb: false,
    dive: false,
    boost: false,
  };

  const rings: FlightCourseRing[] = COURSE_RINGS.map((r) => ({
    id: r.id,
    position: r.position.clone(),
    radius: r.radius,
    cleared: false,
  }));

  const BASE_FLY_SPEED = 14.0;
  const BOOST_MULTIPLIER = 1.75;
  const TURN_RATE = 2.2;
  const CLIMB_RATE = 6.0;

  return {
    setActive(nextActive: boolean) {
      active = nextActive;
    },
    isActive() {
      return active;
    },
    setInput(nextInput: Partial<FlightInputState>) {
      Object.assign(input, nextInput);
    },
    reset() {
      position.copy(initialPosition);
      velocity.set(0, 0, 0);
      heading = 0;
      pitch = 0;
      roll = 0;
      currentSpeed = BASE_FLY_SPEED;
      currentVerticalSpeed = 0;
      gForce = 1.0;
      for (const ring of rings) {
        ring.cleared = false;
      }
    },
    tick(delta: number) {
      if (!active) return;
      const dt = Math.min(delta, 0.1);

      // Target speed calculation
      const targetSpeed = input.boost
        ? BASE_FLY_SPEED * BOOST_MULTIPLIER
        : input.backward
          ? BASE_FLY_SPEED * 0.65
          : BASE_FLY_SPEED;

      currentSpeed = THREE.MathUtils.damp(currentSpeed, targetSpeed, 4.0, dt);

      // Turning & Steering
      let steering = 0;
      if (input.left) steering += 1;
      if (input.right) steering -= 1;

      heading += steering * TURN_RATE * dt;

      // Vertical speed
      let targetV = 0;
      if (input.climb) targetV += CLIMB_RATE;
      if (input.dive) targetV -= CLIMB_RATE;
      currentVerticalSpeed = THREE.MathUtils.damp(currentVerticalSpeed, targetV, 5.0, dt);

      // Roll and Pitch bank response
      const targetRoll = -steering * 0.48;
      const targetPitch = (currentVerticalSpeed / CLIMB_RATE) * 0.28;
      roll = THREE.MathUtils.damp(roll, targetRoll, 6.0, dt);
      pitch = THREE.MathUtils.damp(pitch, targetPitch, 5.0, dt);

      // Position update
      velocity.x = Math.sin(heading) * currentSpeed;
      velocity.z = -Math.cos(heading) * currentSpeed;
      velocity.y = currentVerticalSpeed;

      position.x += velocity.x * dt;
      position.y += velocity.y * dt;
      position.z += velocity.z * dt;

      // Bounded flight floor
      if (position.y < -3.5) {
        position.y = -3.5;
        if (currentVerticalSpeed < 0) currentVerticalSpeed = 0;
      }

      // Normal G-Force calculation: 1.0 + (v * omega) / 9.81
      const turnAccel = Math.abs(steering * TURN_RATE * currentSpeed);
      gForce = Number((1.0 + turnAccel / 9.81).toFixed(2));

      // Ring collision clearance
      for (const ring of rings) {
        if (!ring.cleared && position.distanceTo(ring.position) <= ring.radius) {
          ring.cleared = true;
        }
      }
    },
    getPosition() {
      return position;
    },
    getRotation() {
      return new THREE.Euler(pitch, heading, roll, "YXZ");
    },
    getTelemetry(): InteractiveFlightTelemetry {
      const airspeed = velocity.length();
      const clearedCount = rings.filter((r) => r.cleared).length;
      return {
        active,
        airspeedMps: Number(airspeed.toFixed(1)),
        verticalSpeedMps: Number(currentVerticalSpeed.toFixed(1)),
        altitudeM: Number((position.y + 4.0).toFixed(1)),
        bankDeg: Number(THREE.MathUtils.radToDeg(roll).toFixed(1)),
        pitchDeg: Number(THREE.MathUtils.radToDeg(pitch).toFixed(1)),
        headingDeg: Number((((THREE.MathUtils.radToDeg(heading) % 360) + 360) % 360).toFixed(1)),
        gForce,
        courseRingCount: rings.length,
        ringsCleared: clearedCount,
      };
    },
    getRings() {
      return rings;
    },
  };
}
