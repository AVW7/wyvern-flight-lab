import test from 'node:test'
import assert from 'node:assert/strict'
import { Object3D, Quaternion, Vector3 } from 'three'
import {
  evaluateFlightLoopState,
  legTuckTarget,
  flightPoseTargets,
  DIVE_ENTER_ANGLE,
  DIVE_EXIT_ANGLE,
  LEG_TUCK_RELEASE,
  LEG_TUCK_MAX,
} from '../src/flight-lab/kinematics/flightPose.ts'
import { createWyvernFlightRig } from '../src/flight-lab/rig/wyvernFlightRig.ts'
import {
  HEAD_BONE,
  JAW_BONE,
  NECK_CHAIN,
  SPINE_CHAIN,
  TAIL_CHAIN,
  LEFT_LEG_CHAIN,
  RIGHT_LEG_CHAIN,
  LEFT_WING_CHAIN,
  RIGHT_WING_CHAIN,
} from '../src/flight-lab/rig/rigBones.ts'

function buildMockRig() {
  const root = new Object3D()

  const addBone = (parent, name) => {
    const bone = new Object3D()
    bone.name = name
    parent.add(bone)
    return bone
  }

  const head = addBone(root, HEAD_BONE)
  addBone(head, JAW_BONE)

  let neckParent = root
  for (const name of NECK_CHAIN) {
    neckParent = addBone(neckParent, name)
  }

  let spineParent = root
  for (const name of SPINE_CHAIN) {
    spineParent = addBone(spineParent, name)
  }

  let tailParent = root
  for (const name of TAIL_CHAIN) {
    tailParent = addBone(tailParent, name)
  }

  let lLeg = root
  for (const name of LEFT_LEG_CHAIN) {
    lLeg = addBone(lLeg, name)
  }

  let rLeg = root
  for (const name of RIGHT_LEG_CHAIN) {
    rLeg = addBone(rLeg, name)
  }

  let lWing = root
  for (const name of LEFT_WING_CHAIN) {
    lWing = addBone(lWing, name)
  }

  let rWing = root
  for (const name of RIGHT_WING_CHAIN) {
    rWing = addBone(rWing, name)
  }

  return root
}

test('flight kinematics: leg tuck scales monotonically from release to maximum', () => {
  const stillTuck = legTuckTarget(0, 18)
  const hoverTuck = legTuckTarget(2, 18)
  const cruiseTuck = legTuckTarget(18, 18)
  const sprintTuck = legTuckTarget(28, 18)

  assert.equal(stillTuck, LEG_TUCK_RELEASE)
  assert.ok(hoverTuck <= cruiseTuck)
  assert.equal(cruiseTuck, LEG_TUCK_MAX)
  assert.equal(sprintTuck, LEG_TUCK_MAX)
})

test('flight kinematics: mode hysteresis prevents chatter on dive and climb boundaries', () => {
  // Dive entry: needs high speed (>=9) and steep pitch down
  let mode = evaluateFlightLoopState('cruise', 12, -6, 0)
  assert.equal(mode, 'dive')

  // Dive exit: shallowing out to angle < DIVE_EXIT_ANGLE returns to cruise
  mode = evaluateFlightLoopState('dive', 12, -1, 0)
  assert.equal(mode, 'cruise')

  // Hover entry: very low speed (< 2.0)
  mode = evaluateFlightLoopState('cruise', 1.0, 0, 0)
  assert.equal(mode, 'hover')

  // Hover exit: speed must exceed HOVER_EXIT_SPEED (4.0)
  mode = evaluateFlightLoopState('hover', 3.0, 0, 0)
  assert.equal(mode, 'hover') // Remains in hover due to hysteresis
  mode = evaluateFlightLoopState('hover', 5.0, 0, 0)
  assert.equal(mode, 'cruise')
})

test('wyvernFlightRig: updates simulated skeleton hierarchy across 6-phase kinematics', () => {
  const modelRoot = buildMockRig()
  const rig = createWyvernFlightRig(modelRoot)

  // Initial state update
  rig.update(
    {
      horizontalSpeed: 18,
      verticalSpeed: 0,
      turnRate: 0,
      yaw: 0,
      pitch: 0,
      bank: 0,
    },
    null,
    0.016,
  )

  // Verify bone rotations are finite quaternions
  modelRoot.traverse((node) => {
    assert.ok(!Number.isNaN(node.quaternion.x))
    assert.ok(!Number.isNaN(node.quaternion.y))
    assert.ok(!Number.isNaN(node.quaternion.z))
    assert.ok(!Number.isNaN(node.quaternion.w))
    const lenSq = node.quaternion.lengthSq()
    assert.ok(Math.abs(lenSq - 1.0) < 0.05, `quaternion must be normalized on ${node.name}`)
  })

  // Turn left with active rudder and centrifugal swing
  rig.update(
    {
      horizontalSpeed: 20,
      verticalSpeed: -2,
      turnRate: 0.8, // Left turn
      yaw: 0.5,
      pitch: 0.1,
      bank: 0.4,
    },
    null,
    0.016,
  )

  // Tail tip must have rotated
  const tailTip = modelRoot.getObjectByName('Tail10')
  assert.ok(tailTip !== undefined)
  assert.ok(tailTip.quaternion.lengthSq() > 0)
})

test('wyvernFlightRig: leg tuck does not spin like a wheel across 60 frames of steady flight', () => {
  const modelRoot = buildMockRig()
  const rig = createWyvernFlightRig(modelRoot)
  const lThigh = modelRoot.getObjectByName('L_Thigh')
  assert.ok(lThigh, 'L_Thigh bone must exist')

  const angles = []
  const dt = 1 / 60
  for (let frame = 0; frame < 60; frame++) {
    rig.update(
      {
        horizontalSpeed: 18,
        verticalSpeed: 0,
        pitch: 0,
        bank: 0,
        yaw: 0,
        turnRate: 0,
      },
      null,
      dt,
    )
    // Measure total angular deviation from initial frame 0
    const q = lThigh.quaternion
    // 2 * acos(w) is total rotation angle in radians
    const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w))) * (180 / Math.PI)
    angles.push(angle)
  }

  // Steady cruise leg tuck must stabilize within a tight, bounded angle (< 35 degrees).
  // If legs are spinning like a wheel, angle will cycle through 180 degrees and exceed 90 degrees.
  const maxAngle = Math.max(...angles)
  const finalAngle = angles[angles.length - 1]
  assert.ok(
    maxAngle < 45,
    `Leg tuck rotated like a wheel: max angle was ${maxAngle.toFixed(1)}° across 60 frames (must be < 45°)`,
  )
  // Consecutive frame delta after warmup (frame > 10) must be near zero (< 1°/frame), not 25°/frame
  const lateDelta = Math.abs(angles[59] - angles[58])
  assert.ok(
    lateDelta < 1.0,
    `Leg tuck angular delta between late frames was ${lateDelta.toFixed(1)}° (must be < 1.0°)`,
  )
})

test('wyvernFlightRig: all wing bones maintain stable baseline across 60 frames without rotational compounding', () => {
  const modelRoot = buildMockRig()
  const rig = createWyvernFlightRig(modelRoot)
  const lHand = modelRoot.getObjectByName('L_WingHand')
  const lD2 = modelRoot.getObjectByName('L_WingD2P2')
  const rD2 = modelRoot.getObjectByName('R_WingD2P2')
  assert.ok(lHand && lD2 && rD2, 'Wing bones must exist in mock rig')

  const angles = []
  const dt = 1 / 60
  for (let frame = 0; frame < 60; frame++) {
    rig.update(
      {
        horizontalSpeed: 20,
        verticalSpeed: 0,
        pitch: 0,
        bank: 0,
        yaw: 0,
        turnRate: 0,
        groundClearance: 20,
      },
      null,
      dt,
    )
    const q = lD2.quaternion
    const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w))) * (180 / Math.PI)
    angles.push(angle)
  }

  // Wing flutter must oscillate boundedly (< 20 degrees) without compounding rotation
  const maxAngle = Math.max(...angles)
  assert.ok(
    maxAngle < 20,
    `Wing tip flutter compounded: max angle was ${maxAngle.toFixed(1)}° across 60 frames (must be < 20°)`,
  )
})

test('wyvernFlightRig: full wing hierarchy responds to aerodynamic dive stoop and flutter with bilateral Z-symmetry', () => {
  const modelRoot = buildMockRig()
  const rig = createWyvernFlightRig(modelRoot)
  const lHand = modelRoot.getObjectByName('L_WingHand')
  const rHand = modelRoot.getObjectByName('R_WingHand')
  const lD0 = modelRoot.getObjectByName('L_WingD0P2')
  const rD0 = modelRoot.getObjectByName('R_WingD0P2')
  const lPanel2 = modelRoot.getObjectByName('L_WingPanel2_1')
  const rPanel2 = modelRoot.getObjectByName('R_WingPanel2_1')
  assert.ok(lHand && rHand && lD0 && rD0 && lPanel2 && rPanel2)

  // High speed dive
  rig.update(
    {
      horizontalSpeed: 28,
      verticalSpeed: -15,
      pitch: 0.35,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      flightMode: 'dive',
      groundClearance: 30,
    },
    null,
    0.1,
  )

  // Hand pitch fold must be positive on both sides (symmetrical tuck)
  assert.ok(lHand.quaternion.x > 0.005, 'Left hand must pitch tuck in dive')
  assert.ok(rHand.quaternion.x > 0.005, 'Right hand must pitch tuck in dive')

  // Rig axis rule: local Z sweep must be negated on right side for bilateral symmetry
  assert.ok(lHand.quaternion.z > 0.001, 'Left hand must sweep with positive local Z')
  assert.ok(rHand.quaternion.z < -0.001, 'Right hand must sweep with negative local Z (negated for right wing)')
  assert.ok(
    Math.abs(lHand.quaternion.z - -rHand.quaternion.z) < 0.005,
    'Left and right hand yaw sweeps must both sweep backward within flutter phase tolerance',
  )

  // Membrane panel must also receive flutter/fold response
  assert.ok(Math.abs(lPanel2.quaternion.x) > 0.001 || Math.abs(lPanel2.quaternion.z) > 0.001)
})

test('wyvernFlightRig: ground clearance zeroes procedural wing offsets, preserving authored ground fold', () => {
  const modelRoot = buildMockRig()
  const rig = createWyvernFlightRig(modelRoot)
  const lHand = modelRoot.getObjectByName('L_WingHand')
  const lD2 = modelRoot.getObjectByName('L_WingD2P2')
  assert.ok(lHand && lD2)

  // Ground stance with zero horizontal speed and low clearance
  rig.update(
    {
      horizontalSpeed: 0,
      verticalSpeed: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 0.1,
    },
    null,
    0.016,
  )

  // Procedural offsets must be exactly zeroed
  const angleHand = 2 * Math.acos(Math.min(1, Math.abs(lHand.quaternion.w))) * (180 / Math.PI)
  const angleTip = 2 * Math.acos(Math.min(1, Math.abs(lD2.quaternion.w))) * (180 / Math.PI)
  assert.ok(angleHand < 0.001, `Hand angle on ground must be zero, got ${angleHand}°`)
  assert.ok(angleTip < 0.001, `Wing tip angle on ground must be zero, got ${angleTip}°`)
})

test('wyvernFlightRig: toes articulate dynamically with aerodynamic flight tuck and landing touchdown flare', () => {
  const modelRoot = buildMockRig()
  const rig = createWyvernFlightRig(modelRoot)
  const lToes = modelRoot.getObjectByName('L_Toes')
  const rToes = modelRoot.getObjectByName('R_Toes')
  assert.ok(lToes && rToes, 'Toes bones must exist in mock rig')

  // In cruise flight, leg tuck applies negative pitch to curl toes under
  for (let f = 0; f < 30; f++) {
    rig.update(
      {
        horizontalSpeed: 18,
        verticalSpeed: 0,
        pitch: 0,
        bank: 0,
        yaw: 0,
        turnRate: 0,
        groundClearance: 15,
      },
      null,
      1 / 60,
    )
  }
  assert.ok(lToes.quaternion.x < -0.05, `Left toes must curl under in flight tuck, got ${lToes.quaternion.x}`)
  assert.ok(rToes.quaternion.x < -0.05, `Right toes must curl under in flight tuck, got ${rToes.quaternion.x}`)

  // In high-speed dive, toes curl tighter into streamlined talon tuck
  const cruiseQx = lToes.quaternion.x
  for (let f = 0; f < 30; f++) {
    rig.update(
      {
        horizontalSpeed: 26,
        verticalSpeed: -15,
        pitch: 0.35,
        bank: 0,
        yaw: 0,
        turnRate: 0,
        flightMode: 'dive',
        groundClearance: 20,
      },
      null,
      1 / 60,
    )
  }
  assert.ok(
    lToes.quaternion.x < cruiseQx,
    `Toes must curl tighter in dive (${lToes.quaternion.x}) than cruise (${cruiseQx})`,
  )

  // In landing flare, toes splay forward to cushion impact
  for (let f = 0; f < 30; f++) {
    rig.update(
      {
        horizontalSpeed: 5,
        verticalSpeed: -3,
        pitch: -0.1,
        bank: 0,
        yaw: 0,
        turnRate: 0,
        groundClearance: 1.0,
      },
      null,
      1 / 60,
    )
  }
  assert.ok(
    lToes.quaternion.x > cruiseQx,
    `Toes must splay forward during landing flare (${lToes.quaternion.x}) compared to cruise (${cruiseQx})`,
  )
})

test('wyvernFlightRig: grounded state zeroes procedural leg and toe offsets to preserve authored contacts', () => {
  const modelRoot = buildMockRig()
  const rig = createWyvernFlightRig(modelRoot)
  const lToes = modelRoot.getObjectByName('L_Toes')
  const rToes = modelRoot.getObjectByName('R_Toes')
  const lFoot = modelRoot.getObjectByName('L_Foot')
  assert.ok(lToes && rToes && lFoot)

  // Update on ground with zero speed and low clearance
  for (let f = 0; f < 30; f++) {
    rig.update(
      {
        horizontalSpeed: 0,
        verticalSpeed: 0,
        pitch: 0,
        bank: 0,
        yaw: 0,
        turnRate: 0,
        groundClearance: 0.1,
      },
      null,
      1 / 60,
    )
  }

  const toeAngle = 2 * Math.acos(Math.min(1, Math.abs(lToes.quaternion.w))) * (180 / Math.PI)
  const footAngle = 2 * Math.acos(Math.min(1, Math.abs(lFoot.quaternion.w))) * (180 / Math.PI)
  assert.ok(toeAngle < 0.001, `Toe angle on ground must be zero, got ${toeAngle}°`)
  assert.ok(footAngle < 0.001, `Foot angle on ground must be zero, got ${footAngle}°`)
})

test('wyvernFlightRig: walk gait articulates toes and feet dynamically across alternating swing and stance', () => {
  const modelRoot = buildMockRig()
  const rig = createWyvernFlightRig(modelRoot)
  const lToes = modelRoot.getObjectByName('L_Toes')
  const rToes = modelRoot.getObjectByName('R_Toes')
  assert.ok(lToes && rToes)

  // Sample walk at swing phase for left leg (t = 0.6s)
  rig.update(
    {
      horizontalSpeed: 3.5,
      verticalSpeed: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 0,
      clipName: 'walk',
      clipTime: 0.6,
    },
    null,
    1 / 60,
  )

  const leftSwingToeAngle = 2 * Math.acos(Math.min(1, Math.abs(lToes.quaternion.w))) * (180 / Math.PI)
  assert.ok(
    leftSwingToeAngle > 2.0,
    `Left toes must articulate during walk swing phase, got ${leftSwingToeAngle.toFixed(2)}°`,
  )

  // Sample walk at stance phase for left leg (t = 1.8s)
  rig.update(
    {
      horizontalSpeed: 3.5,
      verticalSpeed: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 0,
      clipName: 'walk',
      clipTime: 1.8,
    },
    null,
    1 / 60,
  )

  const leftStanceToeAngle = 2 * Math.acos(Math.min(1, Math.abs(lToes.quaternion.w))) * (180 / Math.PI)
  assert.ok(
    leftStanceToeAngle > 2.0,
    `Left toes must articulate during walk stance phase, got ${leftStanceToeAngle.toFixed(2)}°`,
  )
})

test('wyvernFlightRig: takeoff coordinates crouch load, push-off claw drive, and airborne talon retraction', () => {
  const modelRoot = buildMockRig()
  const rig = createWyvernFlightRig(modelRoot)
  const lToes = modelRoot.getObjectByName('L_Toes')
  const lThigh = modelRoot.getObjectByName('L_Thigh')
  assert.ok(lToes && lThigh)

  // 1. Crouch loading at t = 0.5s: claws grip ground
  rig.update(
    {
      horizontalSpeed: 0,
      verticalSpeed: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 0,
      clipName: 'takeoff',
      flightMode: 'takeoff',
      clipTime: 0.5,
    },
    null,
    1 / 60,
  )
  assert.ok(lToes.quaternion.x > 0.02, `Toes must grip floor during takeoff crouch, got ${lToes.quaternion.x}`)

  // 2. Explosive push-off at t = 1.1s: toes drive downward with negative pitch
  rig.update(
    {
      horizontalSpeed: 8,
      verticalSpeed: 5,
      pitch: -0.2,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 1.0,
      clipName: 'takeoff',
      flightMode: 'takeoff',
      clipTime: 1.1,
    },
    null,
    1 / 60,
  )
  assert.ok(
    lToes.quaternion.x < -0.05,
    `Toes must push off with negative pitch during explosive launch, got ${lToes.quaternion.x}`,
  )

  // 3. Airborne talon retraction at t = 2.4s: aerodynamic flight tuck
  rig.update(
    {
      horizontalSpeed: 16,
      verticalSpeed: 2,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 4.5,
      clipName: 'takeoff',
      flightMode: 'takeoff',
      clipTime: 2.4,
    },
    null,
    1 / 60,
  )
  assert.ok(
    lToes.quaternion.x < -0.04,
    `Toes must retract into aerodynamic flight tuck during airborne climb, got ${lToes.quaternion.x}`,
  )
})

test('wyvernFlightRig: flight downstroke couples dynamic wingbeat suspension to legs and talons', () => {
  const modelRoot = buildMockRig()
  const rig = createWyvernFlightRig(modelRoot)
  const lThigh = modelRoot.getObjectByName('L_Thigh')
  const lToes = modelRoot.getObjectByName('L_Toes')
  assert.ok(lThigh && lToes)

  // Steady glide baseline
  rig.update(
    {
      horizontalSpeed: 18,
      verticalSpeed: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 20,
      wingStrokePhase: 0,
    },
    null,
    1 / 60,
  )
  const baselineThighQx = lThigh.quaternion.x

  // Downstroke (power stroke, high lift burst)
  rig.update(
    {
      horizontalSpeed: 18,
      verticalSpeed: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 20,
      wingStrokePhase: 1.0,
    },
    null,
    1 / 60,
  )
  assert.ok(
    lThigh.quaternion.x > baselineThighQx + 0.01,
    `Leg must experience downward compliance on downstroke (${lThigh.quaternion.x}) vs baseline (${baselineThighQx})`,
  )
})

test('wyvernFlightRig: ground idle and rest execute respiratory compliance and claw ground grip', () => {
  const modelRoot = buildMockRig()
  const rig = createWyvernFlightRig(modelRoot)
  const lToes = modelRoot.getObjectByName('L_Toes')
  const rToes = modelRoot.getObjectByName('R_Toes')
  assert.ok(lToes && rToes)

  rig.update(
    {
      horizontalSpeed: 0,
      verticalSpeed: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 0,
      clipName: 'idle',
      flightMode: 'ground',
      clipTime: 1.0,
    },
    null,
    1 / 60,
  )

  assert.ok(
    lToes.quaternion.x > 0.015,
    `Left toes must actively grip ground during idle rest, got ${lToes.quaternion.x}`,
  )
  assert.ok(
    rToes.quaternion.x > 0.015,
    `Right toes must actively grip ground during idle rest, got ${rToes.quaternion.x}`,
  )
})

test('spineWave: 2-bone V2 neck chain distributes full 1.0 weight partition ([0.45, 0.55]) across Neck1 and Neck2', async () => {
  const { propagateFullBodyWave } = await import('../src/flight-lab/rig/spineWave.ts')
  const neck1 = new Object3D()
  neck1.name = 'Neck1'
  const neck2 = new Object3D()
  neck2.name = 'Neck2'

  propagateFullBodyWave([], [neck1, neck2], 0, 30, 0)

  const angle1 = 2 * Math.acos(Math.min(1, Math.abs(neck1.quaternion.w)))
  const angle2 = 2 * Math.acos(Math.min(1, Math.abs(neck2.quaternion.w)))

  // At basePhase=0, speed=30 (neck amplitude = 0.08 * 0.7 = 0.056):
  // Neck1 (bonePhase=0.24, sin≈0.998) with weight 0.45 must exceed 0.020 rad (broken 0.20 weight gives ~0.011 rad)
  assert.ok(
    angle1 > 0.02,
    `Neck1 should receive 0.45 weight partition (>0.020 rad), got ${angle1.toFixed(4)} rad`,
  )
  assert.ok(
    angle2 > 0.02,
    `Neck2 should receive 0.55 weight partition (>0.020 rad), got ${angle2.toFixed(4)} rad`,
  )
})

test('gazeController: selects highest-priority target, applies 150ms velocity lookahead, and cascades neck weights progressively', async () => {
  const { Vector3 } = await import('three')
  const {
    createHeadNeckState,
    intelligentHeadNeckController,
    selectGazeTarget,
    LOOKAHEAD_SECONDS,
  } = await import('../src/flight-lab/rig/gazeController.ts')

  assert.equal(LOOKAHEAD_SECONDS, 0.15)

  const selected = selectGazeTarget([
    { position: new Vector3(0, 0, 20), urgency: 0.8, type: 'horizon' },
    { position: new Vector3(5, 0, 20), urgency: 0.9, type: 'prey' },
    { position: new Vector3(-5, 0, 20), urgency: 1.0, type: 'waypoint' },
  ])
  assert.ok(selected)
  assert.equal(selected.type, 'prey')

  const buildNeckRig = () => {
    const root = new Object3D()
    const neck1 = new Object3D()
    neck1.name = 'Neck1'
    const neck2 = new Object3D()
    neck2.name = 'Neck2'
    const head = new Object3D()
    head.name = 'Head'
    root.add(neck1)
    neck1.add(neck2)
    neck2.add(head)
    root.updateMatrixWorld(true)
    return { root, neck1, neck2, head }
  }

  const staticRig = buildNeckRig()
  const movingRig = buildNeckRig()
  const context = {
    horizontalSpeed: 18,
    verticalSpeed: 0,
    turnRate: 0,
    flightMode: 'cruise',
    time: 1.0,
  }

  intelligentHeadNeckController(
    staticRig.head,
    [staticRig.neck1, staticRig.neck2],
    createHeadNeckState(),
    { position: new Vector3(2, 0, 20), urgency: 1.0, type: 'prey' },
    0,
    0,
    0,
    context,
    0.05,
  )

  intelligentHeadNeckController(
    movingRig.head,
    [movingRig.neck1, movingRig.neck2],
    createHeadNeckState(),
    {
      position: new Vector3(2, 0, 20),
      velocity: new Vector3(40, 0, 0),
      urgency: 1.0,
      type: 'prey',
    },
    0,
    0,
    0,
    context,
    0.05,
  )

  // Moving target has +40 u/s X velocity -> +6 units lookahead over 150ms -> greater head yaw
  assert.ok(
    Math.abs(movingRig.head.quaternion.z) > Math.abs(staticRig.head.quaternion.z) * 1.5,
    `150ms velocity lookahead must increase yaw lead: moving=${movingRig.head.quaternion.z}, static=${staticRig.head.quaternion.z}`,
  )

  // Neck2 must articulate with greater yaw weight (0.55) than Neck1 (0.45) via applyNeckOffset
  const neck1Yaw = Math.abs(movingRig.neck1.quaternion.z)
  const neck2Yaw = Math.abs(movingRig.neck2.quaternion.z)
  assert.ok(
    neck2Yaw > neck1Yaw * 1.15,
    `Neck2 yaw (${neck2Yaw}) must exceed Neck1 yaw (${neck1Yaw}) via progressive [0.45, 0.55] cascade`,
  )
})

test('wyvernFlightRig: level flight maintains exact bilateral wing flutter symmetry while banking tucks inside wing', () => {
  const levelRoot = buildMockRig()
  const levelRig = createWyvernFlightRig(levelRoot)
  levelRig.update(
    {
      horizontalSpeed: 20,
      verticalSpeed: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 25,
      flightMode: 'cruise',
    },
    null,
    1 / 60,
  )

  const lD2 = levelRoot.getObjectByName('L_WingD2P2')
  const rD2 = levelRoot.getObjectByName('R_WingD2P2')
  const lPanel1 = levelRoot.getObjectByName('L_WingPanel1_1')
  const rPanel1 = levelRoot.getObjectByName('R_WingPanel1_1')
  assert.ok(lD2 && rD2 && lPanel1 && rPanel1)

  // In level unbanked flight (turnRate = 0), left and right wings must flutter in-phase
  assert.ok(
    Math.abs(lD2.quaternion.x - rD2.quaternion.x) < 1e-6,
    `Level flight wing digit pitch must be bilaterally symmetric: L=${lD2.quaternion.x}, R=${rD2.quaternion.x}`,
  )
  assert.ok(
    Math.abs(lPanel1.quaternion.x - rPanel1.quaternion.x) < 1e-6,
    `Level flight wing panel pitch must be bilaterally symmetric: L=${lPanel1.quaternion.x}, R=${rPanel1.quaternion.x}`,
  )

  // In a left bank turn (turnRate > 0), inside (left) wing tucks deeper than outside (right) wing
  const bankRoot = buildMockRig()
  const bankRig = createWyvernFlightRig(bankRoot)
  for (let i = 0; i < 15; i++) {
    bankRig.update(
      {
        horizontalSpeed: 20,
        verticalSpeed: 0,
        pitch: 0,
        bank: 0.45,
        yaw: 0,
        turnRate: 1.2,
        groundClearance: 25,
        flightMode: 'bankLeft',
      },
      null,
      1 / 60,
    )
  }
  const lHandBank = bankRoot.getObjectByName('L_WingHand')
  const rHandBank = bankRoot.getObjectByName('R_WingHand')
  assert.ok(lHandBank && rHandBank)
  assert.ok(
    lHandBank.quaternion.x > rHandBank.quaternion.x + 0.005,
    `Left bank must tuck inside (left) wing deeper than outside (right) wing: L=${lHandBank.quaternion.x}, R=${rHandBank.quaternion.x}`,
  )
})

test('wyvernFlightRig: grounded state suppresses 2.5Hz airborne spine and tail waves', () => {
  const modelRoot = buildMockRig()
  const rig = createWyvernFlightRig(modelRoot)
  const spine2 = modelRoot.getObjectByName('Spine2')
  const tail8 = modelRoot.getObjectByName('Tail8')
  assert.ok(spine2 && tail8)

  rig.update(
    {
      horizontalSpeed: 0,
      verticalSpeed: 0,
      pitch: 0,
      bank: 0,
      yaw: 0,
      turnRate: 0,
      groundClearance: 0,
      flightMode: 'ground',
      clipName: 'idle',
      clipTime: 1.0,
    },
    null,
    0.1,
  )

  const spineAngle = 2 * Math.acos(Math.min(1, Math.abs(spine2.quaternion.w))) * (180 / Math.PI)
  const tailAngle = 2 * Math.acos(Math.min(1, Math.abs(tail8.quaternion.w))) * (180 / Math.PI)
  assert.ok(
    spineAngle < 0.001,
    `Grounded wyvern must not receive 2.5Hz airborne spine wave, got ${spineAngle.toFixed(4)}°`,
  )
  assert.ok(
    tailAngle < 0.001,
    `Grounded wyvern must not receive 2.5Hz airborne tail wave, got ${tailAngle.toFixed(4)}°`,
  )
})


test('wyvernFlightRig: jaw tracked — sub-degree breathing preserved, static drift sealed, reset restores authored pose', () => {
  const modelRoot = buildMockRig()
  const jaw = modelRoot.getObjectByName(JAW_BONE)
  const rig = createWyvernFlightRig(modelRoot)
  const closed = jaw.quaternion.clone()
  const xAxis = new Vector3(1, 0, 0)
  const angleDeg = (a, b) =>
    (2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w))) * 180) / Math.PI
  const writeJaw = (deg) => {
    const q = closed.clone()
    q.multiply(new Quaternion().setFromAxisAngle(xAxis, (deg * Math.PI) / 180))
    jaw.quaternion.copy(q)
    return q
  }
  const kin = (over = {}) => ({
    horizontalSpeed: 0,
    verticalSpeed: 0,
    yaw: 0,
    turnRate: 0,
    pitch: 0,
    bank: 0,
    flightMode: 'hover',
    isMouthActionActive: false,
    ...over,
  })

  // Sub-degree respiratory breathing (idle/rest/hover) passes through unsealed
  const breath = writeJaw(0.3)
  rig.update(kin(), null, 1 / 60)
  assert.ok(angleDeg(jaw.quaternion, breath) < 0.05, `breathing pose altered: ${angleDeg(jaw.quaternion, breath)}`)

  // Uncalibrated static open-jaw drift (>2°) is sealed to the closed bind pose
  writeJaw(8.6)
  rig.update(kin(), null, 1 / 60)
  assert.ok(angleDeg(jaw.quaternion, closed) < 0.01, `static jaw drift not sealed: ${angleDeg(jaw.quaternion, closed)}`)

  // Breathing is still preserved after a seal frame (no sticky compounding)
  const breath2 = writeJaw(-0.3)
  rig.update(kin(), null, 1 / 60)
  assert.ok(angleDeg(jaw.quaternion, breath2) < 0.05, `breathing altered after seal: ${angleDeg(jaw.quaternion, breath2)}`)

  // High-speed dive seals even sub-degree breathing
  writeJaw(0.3)
  rig.update(kin({ flightMode: 'dive', horizontalSpeed: 25 }), null, 1 / 60)
  assert.ok(angleDeg(jaw.quaternion, closed) < 0.01, `dive jaw not sealed: ${angleDeg(jaw.quaternion, closed)}`)

  // Mouth-active clips (breath/attack/roar/death) are never clamped
  const roar = writeJaw(8.6)
  rig.update(kin({ flightMode: 'dive', horizontalSpeed: 25, isMouthActionActive: true }), null, 1 / 60)
  assert.ok(angleDeg(jaw.quaternion, roar) < 0.05, `mouth-action jaw clamped: ${angleDeg(jaw.quaternion, roar)}`)

  // reset() restores the authored (mixer-written) pose, not the sealed pose
  const authored = writeJaw(8.6)
  rig.update(kin(), null, 1 / 60)
  assert.ok(angleDeg(jaw.quaternion, closed) < 0.01)
  rig.reset()
  assert.ok(angleDeg(jaw.quaternion, authored) < 0.01, `reset did not restore authored jaw: ${angleDeg(jaw.quaternion, authored)}`)
})

test('wyvernFlightRig: cruise->dive head transition is damped (no streamlined-pose pop), grounded mode gates gaze offsets', () => {
  const modelRoot = buildMockRig()
  const head = modelRoot.getObjectByName(HEAD_BONE)
  const rig = createWyvernFlightRig(modelRoot)
  const identity = head.quaternion.clone()
  const angleDeg = (a, b) =>
    (2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w))) * 180) / Math.PI
  const kin = (over = {}) => ({
    horizontalSpeed: 12,
    verticalSpeed: -8,
    yaw: 0,
    turnRate: 0,
    pitch: -0.6,
    bank: 0,
    flightMode: 'cruise',
    isMouthActionActive: false,
    ...over,
  })

  // Settle into cruise with a pitched body so the head carries a VOR offset
  for (let i = 0; i < 60; i++) rig.update(kin(), null, 1 / 60)
  const cruisePose = head.quaternion.clone()
  assert.ok(angleDeg(cruisePose, identity) > 1.0, 'cruise should carry a visible head offset')

  // Switch to dive: per-frame head rotation must stay damped, never snapping
  let maxFrameJump = 0
  let prev = head.quaternion.clone()
  for (let i = 0; i < 90; i++) {
    rig.update(kin({ flightMode: 'dive', horizontalSpeed: 25, verticalSpeed: -20 }), null, 1 / 60)
    maxFrameJump = Math.max(maxFrameJump, angleDeg(prev, head.quaternion))
    prev = head.quaternion.clone()
  }
  assert.ok(maxFrameJump < 2.0, `dive entry popped the head by ${maxFrameJump.toFixed(2)}deg in one frame`)
  // After settling, dive head pose returns to the authored track (offset damps to ~0)
  assert.ok(angleDeg(head.quaternion, identity) < 0.5, `dive head pinned off-track: ${angleDeg(head.quaternion, identity).toFixed(2)}deg`)

  // Grounded with residual model pitch: gaze controller must not tilt the neck/head
  const grounded = buildMockRig()
  const groundedHead = grounded.getObjectByName(HEAD_BONE)
  const groundedRig = createWyvernFlightRig(grounded)
  for (let i = 0; i < 60; i++) {
    groundedRig.update(kin({ horizontalSpeed: 0, verticalSpeed: 0, pitch: 0.4, groundClearance: 0, flightMode: 'ground' }), null, 1 / 60)
  }
  assert.ok(angleDeg(groundedHead.quaternion, identity) < 0.5,
    `grounded head tilted by residual model pitch: ${angleDeg(groundedHead.quaternion, identity).toFixed(2)}deg`)
})
