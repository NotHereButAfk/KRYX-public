import { UserAccount } from './UserAccount.js';
import { EAccount } from './EAccount.js';
const attempts = new Map();
export async function purchaseSkin(itemId) {
  const account = UserAccount.current();
  if (!account || account === '__guest__') throw new Error('Sign in to buy skins with K');
  const identity = `${account}:${itemId}`;
  let attempt = attempts.get(identity);
  if (attempt?.busy) throw new Error('Purchase already in progress');
  if (!attempt) { attempt = { key: crypto.randomUUID(), busy: false }; attempts.set(identity, attempt); }
  attempt.busy = true;
  try {
    const response = await fetch('/api/e/purchase', { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId, key: attempt.key }) });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      if (response.status >= 400 && response.status < 500) attempts.delete(identity);
      throw new Error(result.error || 'Purchase unavailable');
    }
    if (UserAccount.current() !== account) return;
    const profileResponse = await fetch('/api/account/me', { credentials: 'same-origin', cache: 'no-store' });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !profile.ok) throw new Error('Purchase saved. Retry to refresh your inventory.');
    if (UserAccount.current() !== account) return;
    UserAccount.acceptServerProfile(profile.user);
    await EAccount.refresh();
    attempts.delete(identity);
  } finally { attempt.busy = false; }
}
