// Dimensions are CSS pixels. Bound framebuffer memory on tablets while
// retaining extra map detail on high-density phones.
function boundedPixelRatio(ratio, width, height, maxPixels) {
  const area = Math.max(1, width) * Math.max(1, height);
  return Math.min(ratio, Math.sqrt(maxPixels / area));
}

export function rendererPixelRatio(quality, devicePixelRatio = 1, width = 1, height = 1) {
  const dpr = Math.max(1, devicePixelRatio || 1);
  const cap = quality === 'high' ? 2 : quality === 'low' ? 1 : 1.5;
  const budget = quality === 'high' ? 3_686_400 : quality === 'low' ? 1_048_576 : 2_073_600;
  return boundedPixelRatio(Math.min(dpr, cap), width, height, budget);
}

export function postFxPixelRatio(quality, devicePixelRatio = 1, width = 1, height = 1) {
  // Bloom has several buffers; keep its full-scene pass within the medium
  // pixel budget even when the direct renderer is set to high.
  return rendererPixelRatio(quality === 'high' ? 'medium' : quality, devicePixelRatio, width, height);
}

export function bloomEnabled(quality) {
  // Bloom re-renders the full scene through several full-screen buffers. Keep
  // it as an explicit high-quality extra; medium is the default gameplay mode
  // and should prioritize steady input/frame latency on integrated GPUs.
  return quality === 'high';
}

export function lowerRuntimeQuality(quality) {
  if (quality === 'high') return 'medium';
  if (quality === 'medium') return 'low';
  return 'low';
}

export function shouldReduceRuntimeQuality(elapsed, frames, slowFrames) {
  if (elapsed < 2.5 || frames < 30) return false;
  const averageFrameSeconds = elapsed / frames;
  return averageFrameSeconds > 0.0215 || slowFrames / frames > 0.18;
}

export function shouldReduceMenuQuality(elapsed, frames, slowFrames) {
  // The fly-through is the first interactive view, so do not leave a weak GPU
  // struggling for the gameplay monitor's longer grace/sample window. Eight
  // frames is still enough to reject an isolated map/model parse spike while
  // reacting quickly when the spectator render is consistently slow.
  if (elapsed < 1.5 || frames < 8) return false;
  const averageFrameSeconds = elapsed / frames;
  return averageFrameSeconds > 0.025 || slowFrames / frames > 0.28;
}
