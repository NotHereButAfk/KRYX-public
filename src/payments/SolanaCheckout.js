import { Shop } from '../core/Shop.js';
import { Armory } from '../core/Armory.js';

let generation = 0;
let timer;
async function request(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.err || 'Checkout unavailable');
  return data;
}

export async function openSolanaCheckout({ skinId, name, price, onComplete }) {
  const current = ++generation;
  clearTimeout(timer);
  const el = id => document.getElementById(id);
  const modal = el('checkout-modal'), options = el('checkout-payment-options'), status = el('checkout-status');
  const accept = el('checkout-terms-checkbox'), proceed = el('checkout-continue');
  el('checkout-item').textContent = name;
  el('checkout-price').textContent = `$${price.toFixed(2)} USD`;
  modal.querySelectorAll('details').forEach(details => { details.open = false; });
  el('checkout-expiry').textContent = '';
  el('checkout-copy').textContent = 'Copy payment request';
  modal.classList.remove('hidden'); options.classList.add('hidden');
  el('checkout-order').classList.add('hidden');
  el('checkout-assets').classList.remove('hidden');
  accept.checked = false; proceed.disabled = true; proceed.classList.remove('hidden');
  status.textContent = 'Pay with SOL or USDC on Solana.';
  accept.onchange = () => { proceed.disabled = !accept.checked; };
  let activeOrder = null;
  let finished = false;
  async function render(order) {
    if (generation !== current) return;
    activeOrder = order;
    el('checkout-expiry').textContent = '';
    el('checkout-order').classList.toggle('checkout-order-inactive', !order.paymentUrl || ['completed', 'needs_review'].includes(order.status));
    el('checkout-order').classList.remove('hidden');
    el('checkout-assets').classList.add('hidden');
    el('checkout-amount').textContent = `${order.amount} ${order.asset}`;
    el('checkout-order-id').textContent = order.orderId;
    el('checkout-recipient').textContent = order.merchant;
    el('checkout-qr').classList.add('hidden');
    el('checkout-copy').disabled = !order.paymentUrl;
    if (order.status === 'completed') {
      status.textContent = 'PURCHASE COMPLETE — ADDED TO INVENTORY';
      if (!finished) {
        finished = true;
        if (order.kind === 'character') Shop.unlock(order.skinId); else Armory.grantSkin(order.skinId);
        onComplete?.(order);
      }
      return;
    }
    if (order.status === 'needs_review') {
      status.textContent = 'Payment arrived after the quote expired. Contact support with this order number for review. Do not pay again.';
      return;
    }
    if (order.paymentUrl) {
      const { default: QRCode } = await import('qrcode');
      if (generation !== current) return;
      await QRCode.toCanvas(el('checkout-qr'), order.paymentUrl, { width: 220, margin: 2 });
      if (generation !== current) return;
      el('checkout-qr').classList.remove('hidden');
      el('checkout-expiry').textContent = `Pay before ${new Date(order.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      status.textContent = 'Waiting for payment confirmation…';
    } else {
      status.textContent = 'Quote expired. Do not send payment. Payments sent before expiry are still checked automatically; keep this order number if you need help.';
    }
    timer = setTimeout(poll, 12000);
  }
  async function poll() {
    if (generation !== current || !activeOrder || finished) return;
    try { await render(await request(`/api/store/orders/${activeOrder.orderId}`)); }
    catch (e) {
      if (generation !== current) return;
      status.textContent = e.message;
      timer = setTimeout(poll, 15000);
    }
  }
  proceed.onclick = async () => {
    if (!accept.checked) return;
    proceed.disabled = true;
    try {
      const config = await request('/api/store/config');
      if (generation !== current) return;
      el('checkout-sol').disabled = el('checkout-usdc').disabled = !config.configured;
      options.classList.remove('hidden'); proceed.classList.add('hidden');
      status.textContent = 'Choose SOL or USDC. Network fees are paid separately in SOL.';
    } catch (e) { if (generation === current) { status.textContent = e.message; proceed.disabled = false; } }
  };
  for (const asset of ['SOL', 'USDC']) {
    el(`checkout-${asset.toLowerCase()}`).disabled = false;
    el(`checkout-${asset.toLowerCase()}`).onclick = async () => {
      el('checkout-sol').disabled = el('checkout-usdc').disabled = true;
      status.textContent = 'Preparing your payment…';
      try {
        await render(await request('/api/store/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skinId, asset, termsAccepted: accept.checked, termsVersion: '2026-09-17-K' }) }));
      } catch (e) {
        if (generation !== current) return;
        status.textContent = e.message; el('checkout-sol').disabled = el('checkout-usdc').disabled = false;
      }
    };
  }
  el('checkout-copy').onclick = async () => {
    try { if (activeOrder?.paymentUrl) { await navigator.clipboard.writeText(activeOrder.paymentUrl); if (generation === current) el('checkout-copy').textContent = 'Payment request copied'; } }
    catch { status.textContent = 'Copy unavailable. Scan the QR code with a Solana Pay wallet instead.'; }
  };
}

document.getElementById('checkout-close')?.addEventListener('click', () => {
  generation++; clearTimeout(timer);
  document.getElementById('checkout-modal')?.classList.add('hidden');
});
