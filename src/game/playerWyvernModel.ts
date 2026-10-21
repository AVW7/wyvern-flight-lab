export type PlayerWyvernAnimationState = {
  airborne: boolean;
  boosting: boolean;
  speed: number;
  roll: number;
  pitch?: number;
  verticalSpeed?: number;
  turnRate?: number;
  groundClearance?: number;
};

export function resolvePlayerWyvernAnimation(
  state: PlayerWyvernAnimationState,
  availableClips?: Iterable<string>
): string {
  const clipSet = availableClips ? new Set(availableClips) : null;
  const isV2 = clipSet !== null && clipSet.has("cruise") && !clipSet.has("FlightCruise");

  if (!state.airborne) {
    if (isV2) return state.speed > 0.25 ? "walk" : "idle";
    return state.speed > 0.25 ? "GroundWalk" : "Idle";
  }
  if (state.roll > 0.16) return isV2 ? "bankLeft" : "BankLeft";
  if (state.roll < -0.16) return isV2 ? "bankRight" : "BankRight";

  if (isV2 && clipSet) {
    const pitch = state.pitch ?? 0;
    const verticalSpeed = state.verticalSpeed ?? 0;
    if ((pitch < -0.35 || verticalSpeed < -6) && clipSet.has("dive")) return "dive";
    if (state.boosting && clipSet.has("speed")) return "speed";
    if (!state.boosting && state.speed < 3.0 && Math.abs(verticalSpeed) < 2.0 && clipSet.has("hover")) {
      return "hover";
    }
    if (!state.boosting && verticalSpeed < -1.5 && clipSet.has("glide")) return "glide";
  }

  return isV2 ? "cruise" : "FlightCruise";
}
