import type { Object3D } from 'three'

export const HEAD_BONE = 'Head'
export const JAW_BONE = 'Jaw'
export const BODY_BONE = 'Body'
export const ROOT_MOTION_BONE = 'RootMotion'

export const NECK_CHAIN = ['Neck1', 'Neck2'] as const
export const SPINE_CHAIN = ['Spine1', 'Spine2', 'Spine3'] as const

export const TAIL_CHAIN = [
  'Tail1',
  'Tail2',
  'Tail3',
  'Tail4',
  'Tail5',
  'Tail6',
  'Tail7',
  'Tail8',
  'Tail9',
  'Tail10',
] as const

export const LEFT_FOOT_BONE = 'L_Foot'
export const LEFT_TOES_BONE = 'L_Toes'
export const RIGHT_FOOT_BONE = 'R_Foot'
export const RIGHT_TOES_BONE = 'R_Toes'

export const LEFT_LEG_CHAIN = ['L_Thigh', 'L_Calf', 'L_Foot', 'L_Toes'] as const
export const RIGHT_LEG_CHAIN = ['R_Thigh', 'R_Calf', 'R_Foot', 'R_Toes'] as const
export const HIND_LEG_CHAINS = [LEFT_LEG_CHAIN, RIGHT_LEG_CHAIN] as const

export const LEFT_WING_ARM_CHAIN = [
  'L_WingShoulder',
  'L_WingElbow',
  'L_WingWrist',
  'L_WingHand',
] as const

export const RIGHT_WING_ARM_CHAIN = [
  'R_WingShoulder',
  'R_WingElbow',
  'R_WingWrist',
  'R_WingHand',
] as const

export const LEFT_WING_DIGIT_CHAINS = [
  'L_WingD0P0', 'L_WingD0P1', 'L_WingD0P2',
  'L_WingD1P0', 'L_WingD1P1', 'L_WingD1P2',
  'L_WingD2P0', 'L_WingD2P1', 'L_WingD2P2',
  'L_WingD3P0', 'L_WingD3P1', 'L_WingD3P2',
  'L_WingD4P0', 'L_WingD4P1', 'L_WingD4P2',
  'L_WingD5P0', 'L_WingD5P1', 'L_WingD5P2',
] as const

export const RIGHT_WING_DIGIT_CHAINS = [
  'R_WingD0P0', 'R_WingD0P1', 'R_WingD0P2',
  'R_WingD1P0', 'R_WingD1P1', 'R_WingD1P2',
  'R_WingD2P0', 'R_WingD2P1', 'R_WingD2P2',
  'R_WingD3P0', 'R_WingD3P1', 'R_WingD3P2',
  'R_WingD4P0', 'R_WingD4P1', 'R_WingD4P2',
  'R_WingD5P0', 'R_WingD5P1', 'R_WingD5P2',
] as const

export const LEFT_WING_PANEL_CHAINS = [
  'L_WingPanel0_0', 'L_WingPanel0_1',
  'L_WingPanel1_0', 'L_WingPanel1_1',
  'L_WingPanel2_0', 'L_WingPanel2_1',
  'L_WingPanel3_0', 'L_WingPanel3_1',
] as const

export const RIGHT_WING_PANEL_CHAINS = [
  'R_WingPanel0_0', 'R_WingPanel0_1',
  'R_WingPanel1_0', 'R_WingPanel1_1',
  'R_WingPanel2_0', 'R_WingPanel2_1',
  'R_WingPanel3_0', 'R_WingPanel3_1',
] as const

export const LEFT_WING_CHAIN = [
  ...LEFT_WING_ARM_CHAIN,
  ...LEFT_WING_DIGIT_CHAINS,
  ...LEFT_WING_PANEL_CHAINS,
] as const

export const RIGHT_WING_CHAIN = [
  ...RIGHT_WING_ARM_CHAIN,
  ...RIGHT_WING_DIGIT_CHAINS,
  ...RIGHT_WING_PANEL_CHAINS,
] as const

export function findBone(root: Object3D, name: string): Object3D | null {
  let found: Object3D | null = null
  root.traverse((node) => {
    if (found) return
    if (node.name === name || node.userData?.name === name) {
      found = node
    }
  })
  return found
}

export function findChain(root: Object3D, names: readonly string[]): Object3D[] {
  const bones: Object3D[] = []
  for (const name of names) {
    const bone = findBone(root, name)
    if (bone) bones.push(bone)
  }
  return bones
}
