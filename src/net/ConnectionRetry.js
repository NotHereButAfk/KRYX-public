// Keep a single loading attempt active. A slow asset load is never restarted
// merely because it takes time; rejected connections retry with capped backoff.
export async function retryConnection(operation, { signal, onRetry = () => {}, baseMs = 1000, maxMs = 5000 } = {}) {
  let attempt = 0;
  while (true) {
    signal?.throwIfAborted();
    try {
      return await operation();
    } catch (error) {
      signal?.throwIfAborted();
      const delay = Math.min(maxMs, baseMs * 2 ** Math.min(attempt++, 8));
      onRetry(error, attempt, delay);
      await new Promise((resolve, reject) => {
        const stop = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); reject(signal.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, delay);
        signal?.addEventListener('abort', stop, { once: true });
        if (signal?.aborted) stop();
      });
    }
  }
}
