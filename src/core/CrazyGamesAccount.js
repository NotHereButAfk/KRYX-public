export const isCrazyGames = () => typeof location !== 'undefined'
  && location.pathname === '/crazygames.html';

let sdkPromise;
export function getCrazyGamesSDK() {
  if (!sdkPromise) sdkPromise = (async () => {
    if (window.top === window.self) throw new Error('Open this version inside the CrazyGames preview.');
    if (!window.CrazyGames?.SDK) await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => reject(new Error('CrazyGames connection timed out')), 12000);
      script.src = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
      script.onload = () => { clearTimeout(timeout); resolve(); };
      script.onerror = () => { clearTimeout(timeout); reject(new Error('CrazyGames SDK unavailable')); };
      document.head.appendChild(script);
    });
    const sdk = window.CrazyGames.SDK;
    await sdk.init();
    return sdk;
  })();
  return sdkPromise;
}

export async function restoreCrazyGamesAccount(account) {
  // Never reuse another platform identity or a cached website login on failure.
  account.clearServerProfile();
  const cleared = await fetch('/api/account/crazygames/guest', { method: 'POST', credentials: 'same-origin' });
  if (!cleared.ok) throw new Error('Unable to reset the platform session');
  const sdk = await getCrazyGamesSDK();
  if (sdk.user.isUserAccountAvailable) {
    const user = await sdk.user.getUser();
    if (user) {
      const token = await sdk.user.getUserToken();
      const response = await fetch('/api/account/crazygames', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.err || 'CrazyGames login failed');
      // Read authoritative ownership and verify the embedded cookie actually works.
      const profileResponse = await fetch('/api/account/me', { credentials: 'same-origin' });
      const profile = await profileResponse.json();
      if (!profileResponse.ok || String(profile.user?.id) !== String(result.user.id)) throw new Error('Your browser blocked the game session');
      account.acceptServerProfile(profile.user);
    } else account.guest();
    // Reload rebuilds the network connection and clears the previous user's state.
    sdk.user.addAuthListener(() => location.reload());
  } else account.guest();
  return account.current();
}

export async function requestCrazyGamesLogin() {
  const sdk = await getCrazyGamesSDK();
  if (sdk.user.isUserAccountAvailable) await sdk.user.showAuthPrompt();
}
