// Standalone /login page. Shares the same localStorage-backed UserAccount as the
// game, so a successful login sets the session and we bounce back to the game.
import './style.css';
import { UserAccount } from './core/UserAccount.js';

function err(id, msg) { const e = document.getElementById(id); if (e) { e.textContent = msg; e.classList.remove('hidden'); } }
function clearErr(id) { document.getElementById(id)?.classList.add('hidden'); }

const nameEl = document.getElementById('login-name');
const passEl = document.getElementById('login-pass');

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

const doLogin = async () => {
  const button = document.getElementById('login-btn');
  if(button.disabled)return;
  button.disabled=true;
  clearErr('login-err');
  const res = await UserAccount.login(nameEl.value.trim(), passEl.value);
  button.disabled=false;
  if (res.ok) window.location.href = destination();
  else err('login-err', res.err);
};

document.getElementById('login-btn')?.addEventListener('click', doLogin);
passEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });

document.getElementById('guest-btn')?.addEventListener('click', () => {
  UserAccount.guest();
  window.location.href = destination();
});

async function resetRequest(path, data, button) {
  if(button.disabled)return null;
  button.disabled=true;clearErr('reset-err');
  try {
    const response=await fetch(`/api/account/reset/${path}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const result=await response.json();
    if(!result.ok)throw Error(result.err||'Password reset unavailable');
    return result;
  }catch(error){err('reset-err',error.message||'Unable to reach the account server');return null;}
  finally{button.disabled=false;}
}
let resetEmail='';
document.getElementById('reset-btn')?.addEventListener('click',async(event)=>{
  const email=document.getElementById('reset-name').value.trim();
  if(!/^\S+@\S+\.\S+$/.test(email)){err('reset-err','Enter your registered email address');return;}
  const result=await resetRequest('request',{email},event.currentTarget);
  if(result){resetEmail=email;document.getElementById('reset-status').textContent=result.message;document.getElementById('reset-confirm').classList.remove('hidden');document.getElementById('reset-code').focus();}
});
document.getElementById('reset-confirm-btn')?.addEventListener('click',async(event)=>{
  const password=document.getElementById('reset-password').value;
  if(password!==document.getElementById('reset-password-confirm').value){err('reset-err','Passwords do not match');return;}
  const result=await resetRequest('confirm',{email:resetEmail,code:document.getElementById('reset-code').value.trim(),password},event.currentTarget);
  if(result){
    sessionStorage.removeItem('sio_session');localStorage.removeItem('sio_server_profile');
    document.getElementById('reset-confirm').classList.add('hidden');
    document.getElementById('reset-status').textContent='Password updated. Log in with your new password. All previous sessions have been signed out.';
    document.getElementById('reset-password').value='';document.getElementById('reset-password-confirm').value='';
    const link=document.createElement('a');link.href=`/login?next=${encodeURIComponent(returnTo)}`;link.textContent='Log in';link.className='login-link';document.getElementById('reset-status').append(' ',link);
  }
});

// ?reset=1 opens the reset panel directly (from the "Reset your password" tab).
if (new URLSearchParams(location.search).get('reset')) {
  document.getElementById('form-login')?.classList.add('hidden');
  document.getElementById('form-reset')?.classList.remove('hidden');
  document.querySelectorAll('.auth-tab').forEach((t) => t.classList.remove('active'));
  document.getElementById('tab-reset')?.classList.add('active');
  const title = document.querySelector('.login-title');
  if (title) title.textContent = 'Reset your password';
}
