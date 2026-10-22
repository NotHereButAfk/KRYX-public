// The network deadline ends at the first valid snapshot. Asset decoding and
// renderer preparation can take longer on slow connections/devices.
export async function awaitMatchReady(bridge, networkTimeoutMs = 10000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('The selected server did not answer')), networkTimeoutMs);
  });
  try {
    await Promise.race([bridge.handshakePromise, bridge.readyPromise, timeout]);
  } finally {
    clearTimeout(timer);
  }
  return bridge.readyPromise;
}
