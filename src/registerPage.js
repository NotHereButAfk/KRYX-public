// Standalone /register page. Registers into the shared UserAccount store, then
// bounces back to the game already signed in.
import './style.css';
import { UserAccount } from './core/UserAccount.js';

function err(msg) { const e = document.getElementById('reg-err'); if (e) { e.textContent = msg; e.classList.remove('hidden'); } }

const nameEl = document.getElementById('reg-name');
const emailEl = document.getElementById('reg-email');
const passEl = document.getElementById('reg-pass');
const pass2El = document.getElementById('reg-pass2');
const privacyEl = document.getElementById('reg-privacy');
const termsEl = document.getElementById('reg-terms');
const strengthEl = document.getElementById('reg-strength');
const strengthBar = document.getElementById('reg-strength-bar');
const matchEl = document.getElementById('reg-match');

function destination() {
  const next = new URLSearchParams(location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

const returnTo = destination();
if (returnTo !== '/') {
  document.querySelectorAll('[data-auth-route]').forEach((link) => {
    link.href = `/${link.dataset.authRoute}?next=${encodeURIComponent(returnTo)}`;
  });
}

function passwordScore(value) {
  if (!value) return 0;
  let score = value.length >= 8 ? 1 : 0;
  if (value.length >= 12) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value) && /[^a-zA-Z0-9]/.test(value)) score++;
  return Math.min(4, score);
}

function renderPasswordFeedback() {
  const score = passwordScore(passEl.value);
  const labels = ['enter at least 8 characters', 'weak', 'fair', 'good', 'strong'];
  strengthEl.textContent = `Password strength: ${labels[score]}.`;
  strengthEl.dataset.score = String(score);
  strengthBar.style.width = `${score * 25}%`;
  strengthBar.dataset.score = String(score);

  const hasConfirmation = pass2El.value.length > 0;
  const matches = hasConfirmation && passEl.value === pass2El.value;
  matchEl.textContent = hasConfirmation ? (matches ? 'Passwords match.' : 'Passwords do not match.') : 'Passwords must match.';
  matchEl.dataset.match = matches ? 'true' : 'false';
}

const doReg = async () => {
  const button=document.querySelector('#register-form button[type="submit"]');
  if(button?.disabled)return;
  document.getElementById('reg-err')?.classList.add('hidden');
  const email = emailEl.value.trim();
  if (!/^\S+@\S+\.\S+$/.test(email)) { err('Enter a valid email address'); return; }
  if (passEl.value !== pass2El.value) { err("Passwords don't match"); return; }
  if (!privacyEl.checked || !termsEl.checked) { err('Accept the privacy policy and terms of use to continue'); return; }
  if(button)button.disabled=true;
  const res = await UserAccount.register(nameEl.value.trim(), passEl.value, email);
  if(button)button.disabled=false;
  if (res.ok) window.location.href = destination();
  else err(res.err);
};

document.getElementById('register-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  doReg();
});
passEl?.addEventListener('input', renderPasswordFeedback);
pass2El?.addEventListener('input', renderPasswordFeedback);
renderPasswordFeedback();

document.getElementById('guest-btn')?.addEventListener('click', () => {
  UserAccount.guest();
  window.location.href = destination();
});
