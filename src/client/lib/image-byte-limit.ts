const defaultImageByteLimit = 1_500_000;

export const imageJsonOverheadBytes = 4_096;

export function getImageByteLimit(realtimeMessageLimit: number | undefined): number {
  if (!realtimeMessageLimit) {
    return defaultImageByteLimit;
  }

  const imageBudget = Math.floor((realtimeMessageLimit - imageJsonOverheadBytes) * 0.72);

  if (imageBudget <= 0) {
    return defaultImageByteLimit;
  }

  return Math.max(80_000, Math.min(defaultImageByteLimit, imageBudget));
}
