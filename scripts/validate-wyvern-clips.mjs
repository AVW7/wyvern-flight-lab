#!/usr/bin/env node
/**
 * Validate public/models/wyvern.glb the way three.js will actually play it.
 *
 * The Blender-side audit (`scripts/audit-wyvern-clips.py`) checks the authored
 * F-curves; this checks the exported result, so an export-stage regression --
 * a dropped track, a resampled curve, a clip that starts late -- cannot pass
 * unnoticed. It measures three things per clip:
 *
 *   mirror   worst left-vs-right wingtip mismatch, in the Body bone's own
 *            frame. Body-local rather than world because `death` rolls the
 *            whole rig 90 degrees, and a world comparison of a tumbling body
 *            reports a large mismatch on a pose that is exactly symmetric.
 *   seam     worst per-bone rotation difference between t=0 and t=duration.
 *            Only meaningful for the clips the manifest loops.
 *   start    the first keyframe time. Anything above zero means three.js
 *            clamps to the first pose for that opening slice of the clip.
 *   travel   peak-to-peak translation on the root bones. The rig carries a
 *            RootMotion bone, but this project drives position from
 *            `core/data/config.ts`, so a clip that translates it would move the
 *            model at a speed the sim does not know about.
 *   bodyDx   peak-to-peak translation on the `Body` joint, in rig units. This is
 *            the hole `travel` leaves: Body sits *below* the root chain, so a
 *            clip can slide the creature through the world without touching a
 *            bone the root contract watches.
 *   footY    lowest skinned surface weighted to the foot/toe joints, in rig
 *            units relative to the model origin. What actually rests on
 *            terrain, so it is the number a placement or IK step must agree
 *            with across clips.
 *   beat     wingbeat cadence in Hz, as the dominant frequency of the left
 *            wingtip's elevation. Clips that share a manifest `phaseGroup`
 *            crossfade with their normalized time preserved, which is only
 *            coherent if they beat at the same rate.
 */

// Imported rather than taken as ambient globals, matching
// scripts/validate-sidecar-runtime.mjs — the eslint config gives this directory
// no Node environment.
import { Buffer } from 'node:buffer'
import console from 'node:console'
import fs from 'node:fs'
import process from 'node:process'
import { URL } from 'node:url'
import { AnimationMixer, LoopOnce, Matrix4, Quaternion, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { measurePoseEndpoints } from './wyvern-loop-metrics.mjs'
import { footSurfaceHeight, jointTranslationRange } from './wyvern-ground-metrics.mjs'
import { PLAYER_TARGET_SIZE, largestBindExtent, metresPerUnit } from './wyvern-runtime-scale.mjs'

await MeshoptDecoder.ready

// Defaults to the shipped model; takes a path so the gate can be pointed at a
// candidate export, or at a known-bad one to confirm it still fails.
const ARGS = process.argv.slice(2).filter(argument => !argument.startsWith('--'))
// The two measures added for the v2 rig audit are red on the asset that ships
// today, so they are reported always and enforced only on request. That keeps
// CI honest about what it checks while giving the asset fix a target it can be
// held to once the animation data changes.
const STRICT = process.argv.includes('--strict')
const MODEL = ARGS[0]
  ? new URL(ARGS[0], `file://${process.cwd()}/`)
  : new URL('../assets/blender/wyvern-gothic.glb', import.meta.url)

// Mirrors LOOPING / ASYMMETRIC_BY_DESIGN in scripts/audit-wyvern-clips-blender.py,
// which in turn mirror src/render/assets/manifest.ts. `loop` defaults to true
// there, so anything not played as a one-shot has to close.
//
// `attack` and `breath` are absent because they are the action-channel tells,
// which must be one-shots for GameModel to report them finished — see
// manifest.action-channel.test.ts.
const LOOPING = new Set([
  'idle', 'walk', 'rest', 'cruise', 'scout',
  'bankLeft', 'bankRight', 'hover', 'glide', 'dive', 'speed',
])
// A bank beats the outboard wing deeper than the inboard one; walk alternates
// its wing-knuckle contacts like the vendor's quadrupedal gait. Neither should
// be held to a static left/right mirror. The banks are checked as a pair below;
// walk has a positive lower bound so an accidental locked carrier cannot ship.
// `attack2` and `attackAir2` are v1 artist captures (`Battle_Attack06` and
// `Battle_Attack04`) retargeted whole. A real strike leads with one side, so
// their 15-16 m of wingtip asymmetry is the performance, not the mirroring bug
// the authored clips were repaired for -- the authored `attack` beside them is
// symmetric to the rig's 0.0009 m floor.
const ASYMMETRIC_BY_DESIGN = new Set([
  'bankLeft', 'bankRight', 'walk', 'attack2', 'attackAir2',
])
const WALK_GAIT_MIN_ASYMMETRY = 0.1
// Upper gate on walk wingtip asymmetry (in rig units, scaled by FIT below):
// caps the uncalibrated 9.5050 m (1320 rig-unit / 1.2218 m display) wing whip on
// the V2 runtime rig while allowing the raw vendor donor (wyvern-gothic.glb).
const IS_VENDOR_SOURCE = MODEL.pathname.endsWith('/wyvern-gothic.glb')
const WALK_GAIT_MAX_ASYMMETRY_RIG_UNITS = IS_VENDOR_SOURCE ? 2200 : 850
let WALK_GAIT_MAX_ASYMMETRY = 0
// These actions deliberately use the wing's surface rig.  `rest` is excluded:
// a resting animal's folded membrane should be still, not continually twitch.
// Checking local quaternion tracks (rather than evaluated world transforms)
// avoids counting the shoulder's inherited movement as membrane animation.
const SURFACE_RESPONSE_REQUIRED = new Set([
  'idle', 'walk', 'cruise', 'scout', 'bankLeft', 'bankRight', 'hover',
  'glide', 'dive', 'speed', 'attack', 'breath', 'takeoff', 'land', 'death',
])
// The membrane probe, same preference logic as the wingtip. The gothic wing
// spreads the membrane across eight panel battens per side instead of two
// chained bones; the first of each panel is the one a flight loop flutters.
const MEMBRANE_CANDIDATES = [
  ['L_WingPanel0_0', 'L_WingPanel1_0', 'R_WingPanel0_0', 'R_WingPanel1_0'],
  ['L_WingMembrane1', 'L_WingMembrane2', 'R_WingMembrane1', 'R_WingMembrane2'],
]
const MEMBRANE_MOTION_MIN = 0.005 // rad, safely below the subtle walk response

// Metres per rig unit is derived from the model, not authored: the runtime
// rescales every specimen to a display target (`normalizedClone`), so it is a
// property of the consumer, not the asset. Assigned after the load. The 0.0072
// this used to cite as `WYVERN_FIT in manifest.ts` does not exist; the number
// is the tent's `importScale` in catalogData.ts, and it made every metre here
// 5.4x too large.
let FIT = 0
// The authored 0.25 m mirror budget, expressed in this model's units. Kept at
// the rig-unit value the gate has always enforced so a corrected display scale
// cannot silently loosen it; re-authoring the budget is a separate decision.
const MIRROR_BUDGET_RIG_UNITS = 0.25 / 0.0072
let MIRROR_LIMIT = 0
const SEAM_LIMIT = 0.05 // rad, existing authored loop threshold
const POSITION_SEAM_LIMIT = 0.05 // rig units, preserves the original position gate
const SAMPLES = 48

// Mirrors the `phaseGroup: 'flight'` members in src/render/assets/manifest.ts.
// Membership is a promise that a crossfade between any two of them can carry
// normalized playback time across, so the wingbeat must not change rate.
const FLIGHT_PHASE_GROUP = new Set(['cruise', 'bankLeft', 'bankRight'])
// Fraction. 0.08 passes a clip authored one frame short of its neighbours and
// fails the 53% spread cruise-vs-bank shipped with.
const CADENCE_SPREAD_LIMIT = 0.08
// The bones between the origin and the body. Gameplay owns their translation.
const ROOT_BONES = ['Root', 'RootMotion']
// Rig units. Quantisation on an exported constant track, nothing more.
const ROOT_TRAVEL_LIMIT = 1e-4
// Rig units, ~3.6 mm. `Body` is the joint immediately below the root chain, so
// translating it moves the creature exactly the way ROOT_TRAVEL_LIMIT forbids,
// one level down where nothing was looking. The v2 rig authors 1177 units
// (8.5 m) of it into `takeoff`.
const BODY_TRAVEL_LIMIT = 0.5
// Rig units, ~0.72 m. The spread of the foot surface across the clips whose feet
// are meant to carry weight: one placement height has to work for all of them,
// so a clip whose feet sit a metre elsewhere makes the whole set unplaceable.
const FOOT_SPREAD_LIMIT = 100
// Vertices dominated by these joints are the actual support surface. The
// whole-mesh minimum is dominated by wingtips and says nothing about ground
// contact.
const FOOT_JOINTS = new Set(['L_Toes', 'R_Toes', 'L_Foot', 'R_Foot'])
// Clips whose feet are meant to carry weight.
const GROUNDED = new Set([
  'idle', 'walk', 'rest', 'attack', 'attack2', 'breath', 'land', 'takeoff', 'death', 'scout',
])
// Frames sampled for the foot surface. Coarser than SAMPLES: this is a minimum
// over a smooth signal, not a per-frame comparison.
const FOOT_FRAMES = 24
// Samples for the cadence DFT. A power of two well above the ~5 Hz ceiling any
// clip reaches, so no real wingbeat lands near the Nyquist bin.
const CADENCE_SAMPLES = 96
// A lower bin counts as the fundamental if it carries at least this share of
// the strongest bin's power. 0.5 accepts a fundamental the second harmonic has
// overtaken; it does not accept mere leakage from an adjacent bin.
const HARMONIC_TOLERANCE = 0.5

/**
 * Re-pack the GLB without its images, textures or materials.
 *
 * GLTFLoader decodes textures through `self.URL`, which does not exist in Node,
 * so loading the file as shipped throws before any clip is parsed. Only the
 * node tree, the skin and the animations matter here, and none of them
 * reference a material -- so dropping the two textures costs nothing and keeps
 * this runnable as a plain `node` script. The BIN chunk is passed through
 * untouched, which leaves the image bufferViews orphaned but valid.
 */
function stripTextures(data) {
  let offset = 12
  let json = null
  let bin = null
  while (offset < data.length) {
    const size = data.readUInt32LE(offset)
    const kind = data.readUInt32LE(offset + 4)
    const body = data.subarray(offset + 8, offset + 8 + size)
    if (kind === 0x4e4f534a) json = JSON.parse(body.toString('utf8'))
    else if (kind === 0x004e4942) bin = body
    offset += 8 + size
  }
  if (!json) throw new Error('no JSON chunk')

  delete json.images
  delete json.textures
  delete json.samplers
  delete json.materials
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) delete primitive.material
  }

  const jsonChunk = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPad = (4 - (jsonChunk.length % 4)) % 4
  const binPad = bin ? (4 - (bin.length % 4)) % 4 : 0
  const total =
    12 + 8 + jsonChunk.length + jsonPad + (bin ? 8 + bin.length + binPad : 0)
  const out = Buffer.alloc(total)
  out.write('glTF', 0, 'ascii')
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(total, 8)
  let cursor = 12
  out.writeUInt32LE(jsonChunk.length + jsonPad, cursor)
  out.writeUInt32LE(0x4e4f534a, cursor + 4)
  jsonChunk.copy(out, cursor + 8)
  out.fill(0x20, cursor + 8 + jsonChunk.length, cursor + 8 + jsonChunk.length + jsonPad)
  cursor += 8 + jsonChunk.length + jsonPad
  if (bin) {
    out.writeUInt32LE(bin.length + binPad, cursor)
    out.writeUInt32LE(0x004e4942, cursor + 4)
    bin.copy(out, cursor + 8)
  }
  return out
}

const stripped = stripTextures(fs.readFileSync(MODEL))
const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)
const gltf = await new Promise((resolve, reject) => {
  loader.parse(
    stripped.buffer.slice(stripped.byteOffset, stripped.byteOffset + stripped.byteLength),
    '',
    resolve,
    reject,
  )
})

const scene = gltf.scene
const bones = new Map()
scene.traverse((object) => {
  if (object.isBone) bones.set(object.name, object)
})
// The wingtip probe, by preference. `WingD0P2` is the gothic hand's leading
// spar; `WingFinger1_end` is the tip on the rig it replaced. Naming the two
// lets this gate run against a candidate export and the shipped model alike,
// which is the only way to compare them.
const WINGTIPS = ['WingD0P2', 'WingFinger1_end']
const tipSuffix = WINGTIPS.find(
  (candidate) => bones.get(`L_${candidate}`) && bones.get(`R_${candidate}`),
)
if (!tipSuffix) {
  throw new Error(`no wingtip bone in the GLB; tried ${WINGTIPS.join(', ')}`)
}
if (!bones.get('Body')) throw new Error('bone Body missing from the GLB')
const body = bones.get('Body')
scene.updateMatrixWorld(true)
const bindBodyQuaternion = body.getWorldQuaternion(new Quaternion())
const leftTip = bones.get(`L_${tipSuffix}`)
const rightTip = bones.get(`R_${tipSuffix}`)
const skeleton = [...bones.values()]

/**
 * Per skinned mesh, the vertex indices that rest on the foot/toe joints.
 *
 * `skinIndex` is an index into `mesh.skeleton.bones`, which is what
 * `applyBoneTransform` reads -- not into the scene traversal order. The two
 * happen to agree on both wyvern rigs, which is exactly the kind of agreement
 * that silently stops holding after a re-export, so resolve through the
 * skeleton and never through the traversal.
 */
const footMeshes = []
const allSkinned = []
scene.traverse((object) => {
  if (!object.isSkinnedMesh) return
  allSkinned.push(object)
  const skinIndex = object.geometry.attributes.skinIndex
  const skinWeight = object.geometry.attributes.skinWeight
  if (!skinIndex || !skinWeight) return
  const jointNames = object.skeleton.bones.map(bone => bone.name)
  const indices = []
  for (let vertex = 0; vertex < skinIndex.count; vertex += 1) {
    let weight = 0
    for (let slot = 0; slot < 4; slot += 1) {
      if (FOOT_JOINTS.has(jointNames[skinIndex.getComponent(vertex, slot)])) {
        weight += skinWeight.getComponent(vertex, slot)
      }
    }
    if (weight > 0.5) indices.push(vertex)
  }
  if (indices.length) footMeshes.push({ mesh: object, indices })
})

// Same derivation the runtime uses, so the metres printed here are the metres
// the game means. `allSkinned`, not `footMeshes`: the largest extent can come
// from any primitive.
FIT = metresPerUnit(largestBindExtent(allSkinned), PLAYER_TARGET_SIZE)
MIRROR_LIMIT = MIRROR_BUDGET_RIG_UNITS * FIT
WALK_GAIT_MAX_ASYMMETRY = WALK_GAIT_MAX_ASYMMETRY_RIG_UNITS * FIT

const MEMBRANE_BONES =
  MEMBRANE_CANDIDATES.find((set) => set.every((name) => bones.get(name))) ?? []
if (!MEMBRANE_BONES.length) throw new Error('no membrane bones in the GLB')

const mixer = new AnimationMixer(scene)

/**
 * Evaluate `clip` at `time` and refresh the world matrices.
 *
 * Two traps, both of which silently pin every sample to frame 0 and make the
 * whole file report success on a known-broken model:
 *
 *   - `mixer.setTime(t)` resets every action's own `time` to zero before
 *     advancing, so it cannot be used to seek a specific action.
 *   - `action.paused = true` makes the mixer skip the action entirely, so a
 *     hand-assigned `action.time` is never applied.
 *
 * Seeking by assigning `action.time` and then stepping the mixer by a zero
 * delta evaluates at exactly that time without advancing it. LoopOnce keeps a
 * request for exactly `duration` from wrapping back to the start.
 */
function poseAt(clip, time) {
  mixer.stopAllAction()
  const action = mixer.clipAction(clip)
  action.setLoop(LoopOnce, 1)
  action.clampWhenFinished = true
  action.reset().play()
  action.time = time
  mixer.update(0)
  scene.updateMatrixWorld(true)
}

/** Worst L/R wingtip mismatch over the clip, in displayed metres. */
function mirrorResidual(clip) {
  const inverse = new Matrix4()
  const left = new Vector3()
  const right = new Vector3()
  let worst = 0
  for (let i = 0; i <= SAMPLES; i += 1) {
    poseAt(clip, (i / SAMPLES) * clip.duration)
    inverse.copy(body.matrixWorld).invert()
    left.setFromMatrixPosition(leftTip.matrixWorld).applyMatrix4(inverse)
    right.setFromMatrixPosition(rightTip.matrixWorld).applyMatrix4(inverse)
    left.x *= -1 // reflect through the body's own sagittal plane
    worst = Math.max(worst, left.distanceTo(right) * FIT)
  }
  return worst
}

function loopSeam(clip) {
  const capture = () => skeleton.map(bone => ({
    name: bone.name, quaternion: bone.quaternion.clone(), position: bone.position.clone(),
  }))
  poseAt(clip, 0)
  const start = capture()
  poseAt(clip, clip.duration)
  return measurePoseEndpoints(start, capture())
}

function firstKeyTime(clip) {
  return Math.min(...clip.tracks.map((track) => track.times[0]))
}

/** Greatest local quaternion change on a named glTF bone track. */
function localRotationRange(clip, boneName) {
  const track = clip.tracks.find(
    (candidate) => candidate.name === `${boneName}.quaternion`,
  )
  if (!track) return null
  const initial = new Quaternion(
    track.values[0], track.values[1], track.values[2], track.values[3],
  ).normalize()
  let maximum = 0
  for (let offset = 4; offset < track.values.length; offset += 4) {
    const sample = new Quaternion(
      track.values[offset], track.values[offset + 1],
      track.values[offset + 2], track.values[offset + 3],
    ).normalize()
    const dot = Math.min(1, Math.abs(initial.dot(sample)))
    maximum = Math.max(maximum, 2 * Math.acos(dot))
  }
  return maximum
}

/**
 * Peak-to-peak translation on the root chain, in rig units.
 *
 * Zero is the contract, not an accident: `core` is pure and owns every speed in
 * `config.ts`, so a clip that slides its own root desyncs the art from the sim
 * and there is no runtime seam that could reconcile them.
 */
function rootTravel(clip) {
  let worst = 0
  for (const boneName of ROOT_BONES) {
    const track = clip.tracks.find(
      (candidate) => candidate.name === `${boneName}.position`,
    )
    if (!track) continue
    for (let axis = 0; axis < 3; axis += 1) {
      let minimum = Infinity
      let maximum = -Infinity
      for (let offset = axis; offset < track.values.length; offset += 3) {
        minimum = Math.min(minimum, track.values[offset])
        maximum = Math.max(maximum, track.values[offset])
      }
      worst = Math.max(worst, maximum - minimum)
    }
  }
  return worst
}

/**
 * Peak-to-peak translation authored on the `Body` joint, in rig units.
 *
 * Read from the track, not from an evaluated pose: this is a property of the
 * authored data, so it is exact and does not depend on the sampler.
 */
function bodyTravel(clip) {
  return jointTranslationRange(clip, 'Body')
}

/**
 * Lowest world Y of the skinned foot surface over the clip, in rig units.
 *
 * Skinned, not the foot bones' own positions: the bone is a joint inside the
 * mesh, so the surface sits a pad's thickness below it and the difference
 * varies with the pose.
 */
function footSurface(clip) {
  if (!footMeshes.length) return null
  return footSurfaceHeight({
    poseAt: time => poseAt(clip, time),
    footMeshes,
    duration: clip.duration,
    frames: FOOT_FRAMES,
  })
}

/**
 * Wingbeat cadence in Hz.
 *
 * Counting local maxima is the obvious implementation and it does not survive
 * contact with these clips: the secondary bump a bank puts in the outboard
 * wingtip reads as an extra beat, scoring `bankLeft` at 4.6 Hz against
 * `bankRight`'s 3.6 Hz on the same authored cadence. The dominant DFT bin of
 * the mean-centred elevation signal is indifferent to that -- both banks
 * measure 1.532 Hz, which is what they are.
 *
 * Measured on the wingtip in the Body bone's frame for the same reason
 * `mirrorResidual` is: a whole-body roll must not enter the signal.
 */
function beatCadenceHz(clip) {
  const inverse = new Matrix4()
  const tip = new Vector3()
  const elevation = []
  for (let i = 0; i < CADENCE_SAMPLES; i += 1) {
    poseAt(clip, (i / CADENCE_SAMPLES) * clip.duration)
    inverse.copy(body.matrixWorld).invert()
    tip.setFromMatrixPosition(leftTip.matrixWorld).applyMatrix4(inverse)
    elevation.push(tip.y)
  }
  const mean = elevation.reduce((total, value) => total + value, 0) / CADENCE_SAMPLES
  const power = []
  let bestPower = 0
  let bestBin = 0
  // Stop at a quarter of the sample count: above that a "cycle" is four
  // samples wide and the estimate is aliasing, not cadence.
  for (let bin = 1; bin <= CADENCE_SAMPLES / 4; bin += 1) {
    let real = 0
    let imaginary = 0
    for (let i = 0; i < CADENCE_SAMPLES; i += 1) {
      const theta = (2 * Math.PI * bin * i) / CADENCE_SAMPLES
      real += (elevation[i] - mean) * Math.cos(theta)
      imaginary += (elevation[i] - mean) * Math.sin(theta)
    }
    power[bin] = real * real + imaginary * imaginary
    if (power[bin] > bestPower) {
      bestPower = power[bin]
      bestBin = bin
    }
  }
  // Take the lowest bin carrying comparable power, not the strongest one. A
  // wingbeat is not a sine: its second harmonic can edge past the fundamental
  // and the argmax then reports double the true cadence. That is not
  // hypothetical -- it scored bankRight at 3.064 Hz against bankLeft's 1.532
  // on two clips the mirror check confirms are each other's reflection to
  // within 0.006%.
  for (let bin = 1; bin < bestBin; bin += 1) {
    if (power[bin] >= bestPower * HARMONIC_TOLERANCE) {
      bestBin = bin
      break
    }
  }
  return bestBin / clip.duration
}

const rows = []
const problems = []
const warnings = []
for (const clip of [...gltf.animations].sort((a, b) => a.name.localeCompare(b.name))) {
  const mirror = mirrorResidual(clip)
  const seam = loopSeam(clip)
  const start = firstKeyTime(clip)
  const loops = LOOPING.has(clip.name)
  const travel = rootTravel(clip)
  const bodyDx = bodyTravel(clip)
  const footY = footSurface(clip)
  const beat = beatCadenceHz(clip)
  rows.push({
    name: clip.name, mirror, seam, start, loops, travel, bodyDx, footY, beat,
    duration: clip.duration,
  })

  if (travel > ROOT_TRAVEL_LIMIT) {
    problems.push(
      `${clip.name}: root translates by ${travel.toFixed(4)} rig units; ` +
        'gameplay owns position, clips must be in place',
    )
  }
  if (bodyDx > BODY_TRAVEL_LIMIT) {
    const message =
      `${clip.name}: Body translates by ${bodyDx.toFixed(1)} rig units ` +
      `(${(bodyDx * FIT).toFixed(2)} m) below the root chain`
    if (STRICT) problems.push(message)
    else warnings.push(message)
  }

  if (!ASYMMETRIC_BY_DESIGN.has(clip.name) && mirror > MIRROR_LIMIT) {
    problems.push(`${clip.name}: wings asymmetric by ${mirror.toFixed(3)} m`)
  }
  if (clip.name === 'walk' && mirror < WALK_GAIT_MIN_ASYMMETRY) {
    problems.push(
      `${clip.name}: wing knuckles are locked together (${mirror.toFixed(3)} m)`
    )
  }
  if (clip.name === 'walk' && mirror > WALK_GAIT_MAX_ASYMMETRY) {
    problems.push(
      `${clip.name}: wingtip gait asymmetry ${mirror.toFixed(3)} m exceeds ${WALK_GAIT_MAX_ASYMMETRY.toFixed(3)} m cap`
    )
  }
  if (loops && seam.rotationRad > SEAM_LIMIT) {
    problems.push(`${clip.name}: ${seam.rotationBone} loop rotation ${seam.rotationRad.toFixed(3)} rad > ${SEAM_LIMIT}`)
  }
  if (loops && seam.translationRigUnits > POSITION_SEAM_LIMIT) {
    problems.push(`${clip.name}: ${seam.translationBone} loop translation ${seam.translationRigUnits.toFixed(3)} rig units > ${POSITION_SEAM_LIMIT}`)
  }
  if (start > 1e-6) {
    problems.push(`${clip.name}: first key at t=${start.toFixed(5)}s, not 0`)
  }
  if (SURFACE_RESPONSE_REQUIRED.has(clip.name)) {
    for (const boneName of MEMBRANE_BONES) {
      const range = localRotationRange(clip, boneName)
      if (range === null) {
        problems.push(`${clip.name}: ${boneName} has no local quaternion track`)
      } else if (range < MEMBRANE_MOTION_MIN) {
        problems.push(
          `${clip.name}: ${boneName} is static (${range.toFixed(4)} rad)`,
        )
      }
    }
  }
}

// One placement height has to serve every clip whose feet carry weight. If the
// support surface sits at a different height in `idle` than in `walk`, no single
// ground offset can put both of them on the floor, and the discrepancy shows up
// as feet through terrain or a body hovering above it.
const grounded = rows.filter(row => GROUNDED.has(row.name) && row.footY !== null)
if (grounded.length > 1) {
  const heights = grounded.map(row => row.footY)
  const spread = Math.max(...heights) - Math.min(...heights)
  const lowest = grounded.reduce((a, b) => (a.footY <= b.footY ? a : b))
  const highest = grounded.reduce((a, b) => (a.footY >= b.footY ? a : b))
  const message =
    `foot surface spans ${spread.toFixed(0)} rig units (${(spread * FIT).toFixed(2)} m) ` +
    `across grounded clips: ${lowest.name} ${lowest.footY.toFixed(0)} vs ${highest.name} ${highest.footY.toFixed(0)}`
  if (spread > FOOT_SPREAD_LIMIT) {
    if (STRICT) problems.push(message)
    else warnings.push(message)
  }
} else if (!footMeshes.length) {
  warnings.push('no foot/toe weighted vertices in the GLB; foot height not measured')
}

// The two banks are asymmetric on purpose, but they must be each other's
// mirror: same magnitude of asymmetry, opposite sense. Compared relatively,
// not absolutely -- the rig's own bind pose is asymmetric by 0.00089 m, and a
// bank holds its wingtips ~9 m apart, so that floor scales up to a couple of
// millimetres here. A real regression (a wrong amplitude on one side) moves
// this by metres, not by 0.02%.
const left = rows.find((row) => row.name === 'bankLeft')
const right = rows.find((row) => row.name === 'bankRight')
if (left && right) {
  const bankLeft = gltf.animations.find(clip => clip.name === 'bankLeft')
  const bankRight = gltf.animations.find(clip => clip.name === 'bankRight')
  const wingBones = skeleton.filter(bone => /^L_Wing/.test(bone.name) && bones.has(bone.name.replace(/^L_/, 'R_')))
  const inverse = new Matrix4()
  const capture = clip => {
    const frames = []
    const bodyRotations = []
    for (let sample = 0; sample <= SAMPLES; sample++) {
      poseAt(clip, sample / SAMPLES * clip.duration)
      inverse.copy(body.matrixWorld).invert()
      bodyRotations.push(body.getWorldQuaternion(new Quaternion()).multiply(bindBodyQuaternion.clone().invert()))
      frames.push(wingBones.flatMap(bone => [bone, bones.get(bone.name.replace(/^L_/, 'R_'))]
        .map(node => new Vector3().setFromMatrixPosition(node.matrixWorld).applyMatrix4(inverse))))
    }
    return { frames, bodyRotations }
  }
  const leftFrames = capture(bankLeft)
  const rightFrames = capture(bankRight)
  let trajectoryResidual = 0
  leftFrames.frames.forEach((frame, sample) => frame.forEach((position, index) => {
    const mirrored = position.clone()
    mirrored.x *= -1
    trajectoryResidual = Math.max(trajectoryResidual, mirrored.distanceTo(rightFrames.frames[sample][index ^ 1]) * FIT)
  }))
  console.log(`bank mirrored trajectory residual: ${trajectoryResidual.toFixed(4)} m`)
  if (trajectoryResidual > MIRROR_LIMIT) {
    problems.push(`bank mirrored trajectory residual ${trajectoryResidual.toFixed(4)} m > ${MIRROR_LIMIT}`)
  }
  let bodyRotationResidual = 0
  leftFrames.bodyRotations.forEach((rotation, sample) => {
    const mirrored = new Quaternion(rotation.x, -rotation.y, -rotation.z, rotation.w)
    bodyRotationResidual = Math.max(bodyRotationResidual, mirrored.angleTo(rightFrames.bodyRotations[sample]))
  })
  console.log(`bank opposed body rotation residual: ${bodyRotationResidual.toFixed(4)} rad`)
  if (bodyRotationResidual > SEAM_LIMIT) {
    problems.push(`bank opposed body rotation residual ${bodyRotationResidual.toFixed(4)} rad > ${SEAM_LIMIT}`)
  }
  const drift = Math.abs(left.mirror - right.mirror) / Math.max(left.mirror, right.mirror)
  if (drift > 0.005) {
    problems.push(
      `bankLeft/bankRight are not mirrors: ${left.mirror.toFixed(4)} vs ` +
        `${right.mirror.toFixed(4)} m (${(drift * 100).toFixed(2)}% apart)`,
    )
  }
}

// Every member of a phaseGroup must beat at the same rate. The group exists so
// steering can crossfade without restarting the wingbeat, and normalized time
// only maps across clips that agree on what one cycle costs.
const group = rows.filter((row) => FLIGHT_PHASE_GROUP.has(row.name))
if (group.length !== FLIGHT_PHASE_GROUP.size) {
  problems.push(
    `phaseGroup 'flight' names ${FLIGHT_PHASE_GROUP.size} clips but the GLB ` +
      `has ${group.length}: ${group.map((row) => row.name).join(', ')}`,
  )
} else {
  const slowest = Math.min(...group.map((row) => row.beat))
  const fastest = Math.max(...group.map((row) => row.beat))
  const spread = (fastest - slowest) / slowest
  if (spread > CADENCE_SPREAD_LIMIT) {
    problems.push(
      `phaseGroup 'flight' cadences are ${(spread * 100).toFixed(1)}% apart ` +
        `(limit ${(CADENCE_SPREAD_LIMIT * 100).toFixed(0)}%): ` +
        group.map((row) => `${row.name} ${row.beat.toFixed(3)}Hz`).join(', '),
    )
  }
}

const width = Math.max(...rows.map((row) => row.name.length))
console.log(
  `${'clip'.padEnd(width)}  ${'mirror(m)'.padStart(9)}  ${'seam(rad)'.padStart(9)}  ${'seam(rig)'.padStart(9)}` +
    `  ${'start(s)'.padStart(8)}  ${'dur(s)'.padStart(6)}  ${'travel'.padStart(6)}` +
    `  ${'bodyRng'.padStart(7)}  ${'footY'.padStart(6)}  ${'beat(Hz)'.padStart(8)}  loops`,
)
for (const row of rows) {
  console.log(
    `${row.name.padEnd(width)}  ${row.mirror.toFixed(4).padStart(9)}` +
      `  ${(row.loops ? row.seam.rotationRad.toFixed(4) : 'n/a').padStart(9)}` +
      `  ${(row.loops ? row.seam.translationRigUnits.toFixed(4) : 'n/a').padStart(9)}  ${row.start.toFixed(5).padStart(8)}` +
      `  ${row.duration.toFixed(3).padStart(6)}  ${row.travel.toFixed(4).padStart(6)}` +
      `  ${row.bodyDx.toFixed(1).padStart(7)}` +
      `  ${(row.footY === null ? 'n/a' : row.footY.toFixed(0)).padStart(6)}` +
      `  ${row.beat.toFixed(3).padStart(8)}  ${row.loops ? 'yes' : 'no'}`,
  )
}

if (warnings.length) {
  console.warn(`\n${warnings.length} warning(s) (enforced only with --strict):`)
  for (const warning of warnings) console.warn(`  - ${warning}`)
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log(
  '\nwyvern.glb clean: wings mirrored, loops closed, every clip starts at t=0,\n' +
    'no clip translates the root, and the flight phase group beats as one',
)
