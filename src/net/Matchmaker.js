const PROBE_TIMEOUT_MS = 1800;

export function matchmakingUrlFor(wsUrl, baseUrl = globalThis.location?.href) {
  const url = new URL(wsUrl, baseUrl);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/api/matchmake';
  const mode=url.searchParams.get('mode');
  const room=url.searchParams.get('cgroom');
  url.search = '';
  if(mode)url.searchParams.set('mode',mode);
  if(room)url.searchParams.set('cgroom',room);
  url.hash = '';
  return url.href;
}

export function chooseAvailableMatch(matches = []) {
  return matches
    .filter((match) => match?.available !== false && match?.url)
    .sort((a, b) => (a.humans ?? 0) - (b.humans ?? 0)
      || (b.remainingMs ?? 0) - (a.remainingMs ?? 0)
      || (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity))[0] || null;
}

export async function findAvailableMatch(targets, fetchImpl = globalThis.fetch) {
  const unique = [...new Set((targets || []).filter(Boolean))];
  if (!unique.length) return null;
  const probes = await Promise.all(unique.map(async (url) => {
    const started = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetchImpl(matchmakingUrlFor(url), {
        cache: 'no-store', signal: controller.signal,
      });
      if (!response.ok) return null;
      return { ...(await response.json()), url, latencyMs: performance.now() - started };
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }));
  const responsive = probes.filter(Boolean);
  const selected = chooseAvailableMatch(responsive);
  if (selected) return selected;
  // Older dedicated servers may not expose discovery yet. Preserve a direct
  // configured target only when every probe failed; an explicit "full" reply
  // must never be ignored.
  if (!responsive.length) return { url: unique[0], available: true, legacy: true };
  throw new Error('No public server currently has a free player slot');
}
