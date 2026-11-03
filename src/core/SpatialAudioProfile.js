const MAX_AUDIBLE_DISTANCE = 85;
const FULL_CUTOFF_DISTANCE = 4;
const MAX_CUTOFF = 18000;
const MIN_CUTOFF = 2400;

export function spatialAudioProfile(distance, occluded = false) {
  const normalizedDistance = Number.isFinite(distance) && distance >= 0 ? distance : 0;
  const clampedDistance = Math.min(normalizedDistance, MAX_AUDIBLE_DISTANCE);
  const t = Math.max(0, (clampedDistance - FULL_CUTOFF_DISTANCE) / 81);
  const clearCutoff = MAX_CUTOFF * Math.pow(MIN_CUTOFF / MAX_CUTOFF, t);
  const audible = normalizedDistance <= MAX_AUDIBLE_DISTANCE;

  return {
    audible,
    cutoff: occluded ? Math.min(clearCutoff, 2200) : clearCutoff,
    gain: audible ? (occluded ? 0.68 : 1) : 0,
  };
}

export function selectVoiceToSteal(voices, incomingPriority) {
  const priority = Number.isFinite(incomingPriority) ? incomingPriority : 1;
  let selected = null;
  let selectedPriority = Infinity;

  for (const voice of voices) {
    if (voice.priority <= priority && voice.priority < selectedPriority) {
      selected = voice;
      selectedPriority = voice.priority;
    }
  }

  return selected;
}
