const defaultImageByteLimit = 1_500_000;
const minRealtimeImageByteLimit = 80_000;
const realtimeImageBudgetRatio = 0.72;

export const imageJsonOverheadBytes = 4_096;

function getRealtimeImageBudget(realtimeMessageLimit: number): number {
  return Math.floor((realtimeMessageLimit - imageJsonOverheadBytes) * realtimeImageBudgetRatio);
}

export function getImageResizeByteLimit(realtimeMessageLimit: number): number {
  return Math.max(minRealtimeImageByteLimit, getRealtimeImageBudget(realtimeMessageLimit));
}

export function getImageByteLimit(realtimeMessageLimit: number | undefined): number {
  if (!realtimeMessageLimit) {
    return defaultImageByteLimit;
  }

  const imageBudget = getRealtimeImageBudget(realtimeMessageLimit);

  if (imageBudget <= 0) {
    return defaultImageByteLimit;
  }

  return Math.max(minRealtimeImageByteLimit, Math.min(defaultImageByteLimit, imageBudget));
}
