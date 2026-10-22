import { UserAccount } from './UserAccount.js';
// Read-only account projection. Permanent K is never written to browser storage.
export const EAccount = {
  balance: "0.0000",
  loaded: false,
  async refresh() {
    const revision = this._revision = (this._revision || 0) + 1;
    const user = UserAccount.current();
    if (this._user !== user) { this._user = user; this.balance = "0.0000"; this.loaded = false; this.render(); }
    const current = () => revision === this._revision && user === UserAccount.current();
    try {
      const r = await fetch("/api/e/me", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!current()) return;
      if (!r.ok) {
        this.balance = "0.0000";
        this.loaded = false;
        return;
      }
      const p = await r.json();
      if (!current()) return;
      this.balance = p.balance;
      this.loaded = true;
      this.render();
    } catch {
      if (!current()) return;
      this.loaded = false;
    } finally {
      this.render();
    }
  },
  render() {
    const text =
      Number(this.balance).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + " K";
    for (const id of ["nav-coins", "ps-balance", "inv-balance"]) {
      const el = document.getElementById(id);
      if (el) el.textContent = this.loaded ? text : "Sign in to earn K";
    }
  },
};
window.addEventListener("e-balance", (e) => {
  EAccount._user = UserAccount.current();
  EAccount._revision = (EAccount._revision || 0) + 1;
  EAccount.balance = e.detail.balance;
  EAccount.loaded = !e.detail.guest;
  EAccount.render();
});
