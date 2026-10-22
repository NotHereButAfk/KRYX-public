import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
let completed = false, creates = 0;
const order = { ok: true, orderId: '11111111-1111-4111-8111-111111111111', skinId: 'm4_white_signal', kind: 'weapon',
  asset: 'USDC', amount: '20', status: 'pending', expiresAt: new Date(Date.now() + 600000).toISOString(),
  merchant: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  paymentUrl: 'solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v?amount=20&reference=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' };
try {
  await page.route('**/api/store/**', async route => {
    const url = route.request().url();
    if (url.endsWith('/config')) return route.fulfill({ json: { ok: true, configured: true } });
    if (route.request().method() === 'POST') { creates++; assert.equal(route.request().postDataJSON().asset, 'USDC'); }
    return route.fulfill({ json: completed ? { ...order, status: 'completed', paymentUrl: null } : order });
  });
  await page.route('http://127.0.0.1:6003/', route => route.fulfill({ contentType: 'text/html',
    body: readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') }));
  await page.goto('http://127.0.0.1:6003/');
  await page.addStyleTag({ url: '/src/style.css' });
  await page.evaluate(async () => {
    const { openSolanaCheckout } = await import('/src/payments/SolanaCheckout.js');
    openSolanaCheckout({ skinId: 'm4_white_signal', name: 'White Signal', kind: 'weapon', price: 20 });
  });
  assert.equal(await page.locator('#checkout-continue').isDisabled(), true);
  await page.check('#checkout-terms-checkbox'); await page.click('#checkout-continue');
  await page.click('#checkout-usdc');
  await page.waitForSelector('#checkout-qr:not(.hidden)');
  assert.equal(await page.locator('#checkout-amount').textContent(), '20 USDC');
  assert.equal(await page.locator('#checkout-k').count(), 0);
  assert.equal(await page.locator('#checkout-price').textContent(), '$20.00 USD');
  assert.equal(await page.locator('[id*=paypal]').count(), 0);
  await page.screenshot({ path: '../repo-validation/solana-checkout-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.querySelector('.checkout-card').getBoundingClientRect().width <= innerWidth), true);
  await page.screenshot({ path: '../repo-validation/solana-checkout-mobile.png' });
  completed = true;
  await page.waitForFunction(() => document.getElementById('checkout-status').textContent.includes('PURCHASE COMPLETE'), null, { timeout: 20000 });
  assert.equal(creates, 1);
  assert.equal(await page.locator('#checkout-qr').isVisible(), false);
  await page.click('#checkout-close');
  assert.equal(await page.locator('#checkout-modal').isVisible(), false);
  await page.evaluate(async()=>{const {openSolanaCheckout}=await import('/src/payments/SolanaCheckout.js');openSolanaCheckout({skinId:'m4_white_signal',name:'White Signal',price:20});});
  await page.check('#checkout-terms-checkbox');await page.click('#checkout-continue');
  assert.equal(await page.locator('#checkout-assets button').count(), 2);
  assert.equal(await page.locator('#checkout-k').count(), 0);
  await page.route('**/api/e/**',route=>route.fulfill({json:route.request().url().endsWith('/me')
    ?{earningEnabled:true,balance:'1000',sessionE:'0',dailyE:'0',dailyCap:null,catalog:[],equipment:[],ownedSkins:[]}
    :{transactions:[],summaries:[]}}));
  await page.route('**/api/withdrawals',route=>route.fulfill({json:{enabled:false,kPerUSDC:1000,limits:null,withdrawals:[]}}));
  await page.goto('http://127.0.0.1:6003/earnings.html');
  await page.waitForFunction(()=>document.getElementById('withdrawal-status').textContent.includes('not live yet'));
  assert.equal(await page.locator('#withdrawal-form').isVisible(),false);
  await page.screenshot({path:'../repo-validation/k-withdrawals-disabled.png'});
  await page.route('**/api/withdrawals',route=>route.fulfill({json:{enabled:true,kPerUSDC:1000,limits:{minimumK:'5000',perWithdrawalK:null,perUserDailyK:null,globalDailyK:null},withdrawals:[]}}));
  await page.reload();
  await page.waitForFunction(()=>document.getElementById('withdrawal-status').textContent.includes('No daily maximum'));
  assert.equal(await page.locator('#withdrawal-form').isVisible(),true);
  assert.equal(await page.locator('#withdrawal-amount').getAttribute('min'),'5000');
  assert.ok(!(await page.locator('#withdrawal-status').textContent()).includes('null'));
  await page.screenshot({path:'../repo-validation/k-withdrawals-minimum-only.png'});
  assert.deepEqual(errors, []);
  console.log('PASS checkout browser: terms, USDC, QR/link, mobile layout, confirmed delivery, close');
} finally { await browser.close(); }
