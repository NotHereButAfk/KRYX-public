export class EarningsUI {
  constructor(onSummary, isGameplayVisible = () => true) {
    this.onSummary = onSummary;
    this.isGameplayVisible = isGameplayVisible;
    this.lastMatch = null;
    this.notificationTotal = 0;
    this.timer = null;
    this.el = document.createElement("aside");
    this.el.id = "e-hud";
    this.el.className = "hidden";
    this.el.innerHTML =
      '<div class="e-rate-row">Earn Rate <span title="K multipliers applied by the server">ⓘ</span><b data-e="rate">1x</b></div><div class="e-balance-row">Balance <b data-e="balance">0.00</b><span class="e-match-gain">(+<span data-e="match">0.00</span>)</span></div><div class="e-details">Session K: <b data-e="session">0.00</b><div data-e="daily"></div></div><small data-e="status"></small><div id="e-toast" aria-live="polite"></div>';
    document.body.appendChild(this.el);
  }

  format(n) {
    return Number(n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  update(data) {
    this.data = data;
    this.syncVisibility();
    if (!data) {
      return;
    }
    const guest = !!data.guest;
    this.el.querySelector('.e-rate-row').style.display = guest ? 'none' : '';
    this.el.querySelector('.e-details').hidden = guest;
    this.el.querySelector('.e-match-gain').hidden = guest;
    this.el.querySelector('.e-balance-row').firstChild.textContent = guest ? 'Score ' : 'Balance ';
    if (guest) {
      this.el.querySelector('[data-e="balance"]').textContent = Number(data.score || 0).toLocaleString();
      this.el.querySelector('[data-e="status"]').hidden = true;
      this.el.title = 'Match score · 100 points per K equivalent · no currency earned';
      return;
    }
    this.el.title = `K coins earned from server-verified kills and eligible actions. Leaving preserves pending rewards, credited at match end.`;
    const set = (key, text) => {
      this.el.querySelector(`[data-e="${key}"]`).textContent = text;
    };
    set("rate", `${Number(((Number(data.itemMultiplier ?? 1))*(Number(data.modeMultiplier ?? 1))*(Number(data.eventMultiplier ?? 1))*(Number(data.survivalMultiplier ?? 1))).toFixed(2))}x`);
    set("match", this.format(data.finalE));
    set("session", this.format(Number(data.sessionE) + Number(data.finalE)));
    set("balance", this.format(data.balance));
    set(
      "daily",
      data.dailyCap === null
        ? `Daily K: ${this.format(data.dailyE)}`
        : `Daily K: ${this.format(data.dailyE)} / ${this.format(data.dailyCap)}`,
    );
    set(
      "status",
      data.reason ||
        (data.guest
          ? "Temporary guest K · not saved"
          : "Pending server validation"),
    );
    const status=this.el.querySelector('[data-e="status"]');
    status.hidden=!data.reason;
    if(data.reason)status.textContent=data.reason;
    if (data.lastSummary && data.lastSummary.matchId !== this.lastMatch) {
      this.lastMatch = data.lastSummary.matchId;
      // Finalized earnings remain available in the Earn tab and account history.
    }
    window.dispatchEvent(new CustomEvent("e-balance", { detail: data }));
  }
  notify(amount, kind, guestScore) {
    const guest = guestScore !== undefined;
    const value = Number(guest ? guestScore : amount);
    if (!Number.isFinite(value) || value <= 0) return;
    const el = this.el.querySelector("#e-toast");
    const popup = document.createElement("div");
    popup.className = "k-reward-popup";
    popup.textContent = `${kind === "boss" ? "JACKPOT " : ""}+${guest ? Math.round(value).toLocaleString() : this.format(value)} ${guest ? "points" : "K"}`;
    el.appendChild(popup);
    // Show each server reward separately, with a bounded stack for rapid kills.
    while (el.children.length > 4) el.firstElementChild.remove();
    popup.addEventListener("animationend", () => popup.remove(), { once: true });
  }
  syncVisibility() {
    this.el.classList.toggle("hidden", !this.data || !this.isGameplayVisible());
  }
  hide() {
    this.el.classList.add("hidden");
  }
  dispose() {
    clearTimeout(this.timer);
    this.el.remove();
  }
}
