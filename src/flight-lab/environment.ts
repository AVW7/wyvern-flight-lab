import * as THREE from "three";
import type { FlightLabMode, FlightLabTheme } from "./types";

export interface FlightLabEnvironment {
  cameraFill: THREE.DirectionalLight;
  tick(delta: number, mode: FlightLabMode, elapsed: number, paused: boolean): void;
  setTheme(theme: FlightLabTheme, renderer: THREE.WebGLRenderer): void;
  setFloorVisible(visible: boolean): void;
  setFloorY(y: number): void;
  dispose(): void;
}

export function createFlightLabEnvironment(scene: THREE.Scene, initialTheme: FlightLabTheme): FlightLabEnvironment {
  // Ground grid
  const grid = new THREE.GridHelper(100, 40, "#525252", "#1f1f1f");
  grid.position.y = -5.5;
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = initialTheme === "light" ? 0.25 : 0.36;
  scene.add(grid);

  // Ground shadow receiver
  const shadowMaterial = new THREE.ShadowMaterial({
    color: "#000000",
    opacity: initialTheme === "light" ? 0.2 : 0.4,
    transparent: true,
  });
  const shadowReceiver = new THREE.Mesh(new THREE.PlaneGeometry(58, 58), shadowMaterial);
  shadowReceiver.rotation.x = -Math.PI / 2;
  shadowReceiver.position.y = -5.48;
  shadowReceiver.receiveShadow = true;
  scene.add(shadowReceiver);

  // Visible floor plane (toggleable)
  const floorMaterial = new THREE.MeshBasicMaterial({
    color: initialTheme === "light" ? "#d4d4d8" : "#1f1f1f",
    transparent: true,
    opacity: initialTheme === "light" ? 0.35 : 0.25,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const floorPlane = new THREE.Mesh(new THREE.PlaneGeometry(58, 58), floorMaterial);
  floorPlane.rotation.x = -Math.PI / 2;
  floorPlane.position.y = -5.5;
  floorPlane.visible = false;
  scene.add(floorPlane);

  // Aerodynamic wind tunnel frames
  const tunnel = new THREE.Group();
  const tunnelMaterials: THREE.LineBasicMaterial[] = [];
  for (let index = 0; index < 12; index += 1) {
    const ringMaterial = new THREE.LineBasicMaterial({
      color: index % 3 === 0 ? "#737373" : (initialTheme === "light" ? "#cccccc" : "#2e2e2e"),
      transparent: true,
      opacity: initialTheme === "light" ? 0.25 : 0.35,
    });
    tunnelMaterials.push(ringMaterial);
    const ring = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(24, 15, 0.1)),
      ringMaterial
    );
    ring.position.z = -index * 8 + 12;
    tunnel.add(ring);
  }
  scene.add(tunnel);

  // Lights
  const key = new THREE.DirectionalLight("#ffffff", initialTheme === "light" ? 4.2 : 4.5);
  key.position.set(-10, 14, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -13;
  key.shadow.camera.right = 13;
  key.shadow.camera.top = 13;
  key.shadow.camera.bottom = -13;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 48;
  key.shadow.bias = -0.00035;
  key.shadow.normalBias = 0.025;

  const cameraFill = new THREE.DirectionalLight(initialTheme === "light" ? "#e4e4e7" : "#d4d4d8", initialTheme === "light" ? 1.4 : 1.8);
  const rim = new THREE.DirectionalLight("#ffffff", initialTheme === "light" ? 2.0 : 2.6);
  rim.position.set(10, 5, -12);

  const fill = new THREE.HemisphereLight(
    initialTheme === "light" ? "#ffffff" : "#e4e4e7",
    initialTheme === "light" ? "#cccccc" : "#18181b",
    initialTheme === "light" ? 0.78 : 0.75
  );

  const practical = new THREE.PointLight("#ffffff", initialTheme === "light" ? 3.0 : 4.5, 22, 2);
  practical.position.set(-7, -1, -5);

  scene.add(key, key.target, cameraFill, cameraFill.target, rim, rim.target, fill, practical);

  // Dust particles
  const particleMaterial = new THREE.PointsMaterial({
    color: initialTheme === "light" ? "#525252" : "#d4d4d8",
    size: 0.07,
    transparent: true,
    opacity: initialTheme === "light" ? 0.4 : 0.55,
  });
  const particles = new THREE.Points(
    new THREE.BufferGeometry(),
    particleMaterial
  );
  const particlePositions = new Float32Array(180 * 3);
  for (let index = 0; index < 180; index += 1) {
    particlePositions[index * 3] = (Math.random() - 0.5) * 24;
    particlePositions[index * 3 + 1] = (Math.random() - 0.5) * 14;
    particlePositions[index * 3 + 2] = Math.random() * 80 - 55;
  }
  particles.geometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
  scene.add(particles);

  return {
    cameraFill,
    tick(delta, mode, elapsed, paused) {
      tunnel.position.z = (elapsed * (mode === "boost" ? 11 : 5)) % 8;

      if (!paused) {
        const flow = mode === "boost" ? 32 : mode === "ground" ? 4 : 16;
        for (let index = 0; index < 180; index += 1) {
          const offset = index * 3 + 2;
          const nextDepth = (particlePositions[offset] ?? -56) + delta * flow;
          particlePositions[offset] = nextDepth > 24 ? -56 : nextDepth;
        }
        (particles.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      }
    },
    setTheme(theme, renderer) {
      const light = theme === "light";
      scene.background = new THREE.Color(light ? "#ebebeb" : "#080808");
      scene.fog = new THREE.FogExp2(light ? "#ebebeb" : "#080808", light ? 0.012 : 0.018);
      renderer.toneMappingExposure = light ? 1.05 : 1.22;

      key.color.set("#ffffff");
      key.intensity = light ? 4.2 : 5.0;
      cameraFill.color.set(light ? "#e4e4e7" : "#d4d4d8");
      cameraFill.intensity = light ? 1.4 : 2.0;
      rim.color.set("#ffffff");
      rim.intensity = light ? 2.0 : 2.6;
      fill.color.set(light ? "#ffffff" : "#e4e4e7");
      fill.groundColor.set(light ? "#cccccc" : "#18181b");
      fill.intensity = light ? 0.78 : 0.95;
      practical.color.set("#ffffff");
      practical.intensity = light ? 3.0 : 4.5;
      shadowMaterial.opacity = light ? 0.2 : 0.4;
      (grid.material as THREE.Material).opacity = light ? 0.25 : 0.36;

      particleMaterial.color.set(light ? "#525252" : "#d4d4d8");
      particleMaterial.opacity = light ? 0.4 : 0.55;

      tunnelMaterials.forEach((material, index) => {
        material.color.set(index % 3 === 0 ? "#737373" : (light ? "#cccccc" : "#2e2e2e"));
        material.opacity = light ? 0.25 : 0.35;
      });

      floorMaterial.color.set(light ? "#d4d4d8" : "#1f1f1f");
      floorMaterial.opacity = light ? 0.35 : 0.25;
    },
    setFloorVisible(visible: boolean) {
      floorPlane.visible = visible;
    },
    setFloorY(y: number) {
      floorPlane.position.y = y;
      grid.position.y = y - 0.02;
      shadowReceiver.position.y = y + 0.02;
    },
    dispose() {
      grid.removeFromParent();
      (grid.material as THREE.Material).dispose();
      grid.geometry.dispose();

      shadowReceiver.removeFromParent();
      shadowMaterial.dispose();
      shadowReceiver.geometry.dispose();

      floorPlane.removeFromParent();
      floorMaterial.dispose();
      floorPlane.geometry.dispose();

      tunnel.removeFromParent();
      tunnelMaterials.forEach((m) => m.dispose());

      key.removeFromParent();
      cameraFill.removeFromParent();
      rim.removeFromParent();
      fill.removeFromParent();
      practical.removeFromParent();

      particles.removeFromParent();
      particleMaterial.dispose();
      particles.geometry.dispose();
    },
  };
}
