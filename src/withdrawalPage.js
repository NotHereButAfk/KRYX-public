import './style.css';
import { UserAccount } from './core/UserAccount.js';

await UserAccount.restore();
if (!UserAccount.current() || UserAccount.isGuest()) {
  const next = encodeURIComponent('/withdrawal');
  window.location.replace(`/login?next=${next}`);
}
