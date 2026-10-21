import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createFlightLabCamera } from "../src/flight-lab/camera.ts";

function createCameraContainer() {
  return {
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
  };
}

test("chase camera translates with a landed wyvern while preserving its target", () => {
  const perspective = new THREE.PerspectiveCamera(43, 16 / 9, 0.1, 180);
  const orthographic = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 180);
  const camera = createFlightLabCamera(createCameraContainer(), perspective, orthographic);
  const groundedY = -5.45;

  camera.setPreset("chase");
  camera.tick(0, undefined, groundedY);
  perspective.updateMatrixWorld(true);

  const expectedTarget = new THREE.Vector3(0, groundedY, 0);
  const expectedDirection = expectedTarget.sub(perspective.position).normalize();
  assert.ok(
    perspective.getWorldDirection(new THREE.Vector3()).distanceTo(expectedDirection) < 1e-9,
    "the camera must keep looking at the translated wyvern rather than the flight-height origin"
  );
  assert.ok(
    Math.abs(perspective.position.y - (Math.sin(0.25) * 22 + groundedY)) < 1e-9,
    "spherical orbit height should align with followed target + elevation delta"
  );
});

test("camera supports super-close detail zoom down to 1.2m without distortion", () => {
  const perspective = new THREE.PerspectiveCamera(43, 16 / 9, 0.1, 180);
  const orthographic = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 180);
  const camera = createFlightLabCamera(null, perspective, orthographic);

  camera.setPreset("detail");
  assert.equal(camera.getCameraState().preset, "detail");
  assert.ok(camera.getDistance() <= 3.5);

  // Zoom in further toward extreme macro detail inspection
  camera.zoomBy(-10);
  assert.equal(camera.getDistance(), 1.2, "zoom distance must clamp safely to 1.2m");

  camera.tick(0.016, undefined, new THREE.Vector3(0, 0, 0));
  perspective.updateMatrixWorld(true);

  // Direction should stay pointed precisely at target
  const state = camera.getCameraState();
  const target = new THREE.Vector3(state.targetX, state.targetY, 0);
  const dir = target.clone().sub(perspective.position).normalize();
  assert.ok(perspective.getWorldDirection(new THREE.Vector3()).distanceTo(dir) < 1e-6);

  // Zoom out safely clamped
  camera.zoomBy(100);
  assert.equal(camera.getDistance(), 70);
});

test("takeoff preset positions camera at low angle for ground push-off tracking", () => {
  const perspective = new THREE.PerspectiveCamera(43, 16 / 9, 0.1, 180);
  const orthographic = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 180);
  const camera = createFlightLabCamera(null, perspective, orthographic);

  camera.setPreset("takeoff");
  const state = camera.getCameraState();
  assert.equal(state.preset, "takeoff");
  assert.equal(state.isOrtho, false);
  assert.ok(state.elevation < 0.2, "takeoff camera must be low-angle to frame ground contact and liftoff");
});
