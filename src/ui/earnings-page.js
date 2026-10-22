const $ = (id) => document.getElementById(id),
  fmt = (n) =>
    Number(n || 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
async function api(path, data) {
  const r = await fetch("/api/e/" + path, {
    credentials: "same-origin",
    ...(data
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      : {}),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error || "K unavailable");
  return value;
}
function text(tag, value, parent) {
  const el = document.createElement(tag);
  el.textContent = value;
  parent.appendChild(el);
  return el;
}
async function load() {
  try {
    const p = await api("me"),
      h = await api("history");
    $("status").textContent = p.earningEnabled
      ? "Rewards are finalized by the game server."
      : "K earning is currently disabled.";
    $("account").hidden = false;
    loadWithdrawals();
    $("admin-link").hidden = !p.admin;
    $("balance").textContent = fmt(p.balance) + " K";
    $("session").textContent = fmt(p.sessionE);
    $("daily").textContent =
      fmt(p.dailyE) + (p.dailyCap === null ? "" : " / " + fmt(p.dailyCap));
    $("equipment").replaceChildren();
    for (const kind of ["character", "weapon"]) {
      const label = text("label", kind + " earning item", $("equipment")),
        select = document.createElement("select");
      text("option", "None — base earnings", select).value = "";
      for (const item of p.catalog.filter(
        (i) =>
          i.kind === kind &&
          p.ownedSkins.some((s) => s.id === i.id && s.kind === kind),
      )) {
        text(
          "option",
          `${item.id} · ${item.earningEnabled ? "bonus enabled" : "cosmetic only"}`,
          select,
        ).value = item.id;
      }
      select.value = p.equipment.find((e) => e.kind === kind)?.item_id || "";
      label.appendChild(select);
      select.onchange = async () => {
        try {
          await api("equip", { kind, itemId: select.value || null });
          $("status").textContent = "Equipment saved for your next match.";
        } catch (e) {
          $("status").textContent = e.message;
        }
      };
    }
    $("catalog").replaceChildren();
    text("p", "Skins are available in the Night Market with SOL or USDC. In-game currency cannot be used to buy skins.", $("catalog"));
    $("ledger").replaceChildren();
    for (const t of h.transactions) {
      const row = document.createElement("tr");
      for (const v of [
        new Date(t.created_at).toLocaleString(),
        t.type,
        fmt(t.amount) + " K",
        fmt(t.new_balance) + " K",
        t.description,
      ])
        text("td", v, row);
      $("ledger").appendChild(row);
    }
    $("summaries").replaceChildren();
    for (const s of h.summaries) {
      const box = document.createElement("details");
      text(
        "summary",
        `${fmt(s.finalE)} K · match ${s.matchId.slice(0, 8)}`,
        box,
      );
      for (const [key, label] of [
        ["score", "Score"],
        ["eligibleScore", "Eligible score"],
        ["baseE", "Base K"],
        ["itemBonus", "Item bonus"],
        ["survivalBonus", "Survival bonus"],
        ["eventBonus", "Event bonus"],
        ["bossRewards", "Boss rewards"],
        ["winReward", "Win reward"],
        ["capReduction", "Reduction"],
      ])
        if (Number(s[key])) text("p", `${label}: ${fmt(s[key])}`, box);
      if (s.reason) text("p", s.reason, box);
      $("summaries").appendChild(box);
    }
  } catch (e) {
    $("status").textContent =
      e.message + " — sign in with a registered account to view permanent K.";
  }
}
let withdrawalKey = crypto.randomUUID();
async function loadWithdrawals() {
  try {
    const response = await fetch('/api/withdrawals', { credentials: 'same-origin' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Payout status unavailable');
    $('withdrawal-form').hidden = !data.enabled;
    if (data.limits?.minimumK) $('withdrawal-amount').min = data.limits.minimumK;
    $('withdrawal-status').textContent = data.enabled
      ? `Minimum: ${data.limits.minimumK} K. ${data.limits.perWithdrawalK == null ? 'No per-withdrawal maximum.' : `Per withdrawal: ${data.limits.perWithdrawalK} K.`} ${data.limits.perUserDailyK == null ? 'No daily maximum.' : `Daily: ${data.limits.perUserDailyK} K.`} Network fees are paid by the game.`
      : 'USDC withdrawals are not live yet. Payout wallet setup and funding are required. Your K stays in your balance.';
    $('withdrawal-history').replaceChildren();
    for (const row of data.withdrawals) {
      const box = document.createElement('article');
      const micro = BigInt(row.usdc_units);
      text('p', `${row.k_amount} K → ${micro / 1000000n}.${String(micro % 1000000n).padStart(6,'0')} USDC · ${row.state}`, box);
      text('p', `Recipient: ${row.destination}`, box);
      if (row.reason) text('p', row.reason, box);
      if (row.signature) { const link = text('a','View transaction',box); link.href=`https://solscan.io/tx/${encodeURIComponent(row.signature)}`; link.target='_blank';link.rel='noopener noreferrer'; }
      $('withdrawal-history').appendChild(box);
    }
  } catch(e) { $('withdrawal-status').textContent=e.message; }
}
$('withdrawal-amount').oninput = () => {
  withdrawalKey=crypto.randomUUID();
  const raw=$('withdrawal-amount').value;
  if (!/^\d+(\.\d{1,3})?$/.test(raw)) { $('withdrawal-quote').textContent='Use up to three decimal places.';return; }
  const [whole,frac='']=raw.split('.');
  const micro=BigInt(whole)*1000n+BigInt(frac.padEnd(3,'0'));
  $('withdrawal-quote').textContent=`You receive ${micro/1000000n}.${String(micro%1000000n).padStart(6,'0')} USDC.`;
};
$('withdrawal-address').oninput=()=>{withdrawalKey=crypto.randomUUID();};
$('withdrawal-form').onsubmit=async event=>{
  event.preventDefault();$('withdrawal-submit').disabled=true;
  try {
    const response=await fetch('/api/withdrawals',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({amountK:$('withdrawal-amount').value,destination:$('withdrawal-address').value.trim(),key:withdrawalKey,termsAccepted:$('withdrawal-terms').checked,termsVersion:'2026-09-17-K'})});
    const data=await response.json();if(!response.ok)throw Error(data.error || 'Withdrawal unavailable');
    await load();
    $('withdrawal-status').textContent=`Withdrawal ${data.id} is ${data.state}. K is reserved until the payout finishes.`;
  }catch(e){$('withdrawal-status').textContent=e.message;}finally{$('withdrawal-submit').disabled=false;}
};
load();
