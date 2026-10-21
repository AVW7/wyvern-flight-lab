import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AnimationMixer, LoopOnce, Quaternion, QuaternionKeyframeTrack, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

async function loadPlayer() {
  const bytes = readFileSync(new URL("../public/models/player-wyvern.glb", import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + jsonLength));
  // Evaluate the real skeleton and clips without loading browser-only image textures.
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  delete json.materials;
  delete json.images;
  delete json.textures;
  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32);
  encoded.copy(padded);
  const binary = bytes.subarray(20 + jsonLength);
  const output = Buffer.alloc(20 + padded.length + binary.length);
  bytes.copy(output, 0, 0, 20);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12);
  padded.copy(output, 20);
  binary.copy(output, 20 + padded.length);
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(
    output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength), ""
  );
}

function sampleBody(scene, clip) {
  const mixer = new AnimationMixer(scene);
  const action = mixer.clipAction(clip).setLoop(LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const pelvis = scene.getObjectByName("Bip002-Pelvis_07");
  assert.ok(pelvis, "Player body bone must bind");
  const samples = [];
  for (let frame = 0; frame <= 48; frame++) {
    mixer.setTime(clip.duration * frame / 48);
    scene.updateMatrixWorld(true);
    samples.push(pelvis.getWorldQuaternion(new Quaternion()));
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
  return samples;
}

function assertSteadyCruise(scene, clip) {
  const poses = sampleBody(scene, clip);
  const seam = poses[0].angleTo(poses.at(-1));
  // 0.1 degrees projects to <1 pixel at a 480px radius in the 960px audit render.
  assert.ok(seam < Math.PI / 1800, `Cruise loop snaps by ${seam * 180 / Math.PI} degrees`);
  for (const pose of poses) {
    assert.ok(poses[0].angleTo(pose) < Math.PI / 2, "Cruise must stay in its initial orientation hemisphere");
  }
}

test("player cruise closes its body pose and never reverses the flight heading", async () => {
  const { scene, animations } = await loadPlayer();
  const clip = animations.find((clip) => clip.name === "FlightCruise");
  assert.ok(clip);
  assertSteadyCruise(scene, clip);
});

test("cruise gate rejects a corrupted final body rotation", async () => {
  const { scene, animations } = await loadPlayer();
  const clip = animations.find((clip) => clip.name === "FlightCruise").clone();
  const track = clip.tracks.find((track) => track.name === "Bip002-Pelvis_07.quaternion");
  assert.ok(track);
  const first = Array.from(track.createInterpolant().evaluate(0));
  const rotated = new Quaternion().fromArray(first)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2));
  clip.tracks[clip.tracks.indexOf(track)] = new QuaternionKeyframeTrack(
    track.name, [0, clip.duration], [...first, ...rotated.toArray()]
  );
  assert.throws(() => assertSteadyCruise(scene, clip), /Cruise loop snaps/);
});
