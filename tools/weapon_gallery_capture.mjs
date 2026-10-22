import { chromium } from 'playwright';

const url = process.env.KYX_URL || 'http://127.0.0.1:5997/';
const output = process.env.KYX_WEAPON_GALLERY || 'weapon-model-gallery.png';
const galleryUrl = new URL('/login', url).href;
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: ['--use-gl=swiftshader', '--enable-webgl', '--no-sandbox',
    '--disable-dev-shm-usage', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1040 }, deviceScaleFactor: 1 });
await page.route(/fonts\.(?:googleapis|gstatic)\.com/, (route) => route.abort());

try {
  await page.goto(galleryUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const count = await page.evaluate(async () => {
    const [{ WEAPONS }, models, thumbs] = await Promise.all([
      import('/src/weapons/weaponDefs.js'),
      import('/src/weapons/WeaponModels.js'),
      import('/src/ui/WeaponThumbnails.js'),
    ]);
    await new Promise((resolve) => {
      models.onWeaponModelsReady(resolve);
      models.preloadWeaponModels();
      setTimeout(resolve, 12000);
    });
    const guns = WEAPONS.filter((weapon) => weapon.kind !== 'melee');
    document.body.innerHTML = `
      <main class="gallery">
        <header><div class="eyebrow">KYX.IO ARMORY</div><h1>ALL GUN MODELS</h1><p>${guns.length} production firearms</p></header>
        <section id="gallery-grid"></section>
      </main>`;
    const style = document.createElement('style');
    style.textContent = `
      *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#070b11;color:#eef2f5;font-family:Arial,sans-serif}
      body{background:radial-gradient(circle at 50% -20%,#263542 0,#0d141d 32%,#05080d 78%)}
      .gallery{width:1600px;padding:38px 46px 46px}header{display:flex;align-items:baseline;gap:22px;margin-bottom:25px;border-bottom:1px solid #40505c;padding-bottom:18px}
      .eyebrow{color:#d7e83e;font-size:12px;font-weight:800;letter-spacing:3px}h1{font-size:32px;letter-spacing:2px;margin:0}header p{margin:0 0 3px auto;color:#8fa0ac;font-size:14px}
      #gallery-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:14px}.card{height:215px;position:relative;overflow:hidden;background:linear-gradient(145deg,rgba(29,41,53,.96),rgba(10,15,22,.98));border:1px solid #2c3a45;border-left:3px solid #d7e83e}
      .card img{display:block;width:100%;height:166px;object-fit:contain;padding:7px 12px 0;filter:drop-shadow(0 10px 10px rgba(0,0,0,.55))}.label{position:absolute;left:13px;right:12px;bottom:10px;display:flex;align-items:end;gap:8px}.name{font-size:15px;font-weight:800;letter-spacing:.5px}.id{margin-left:auto;color:#738692;font:11px monospace}.num{color:#d7e83e;font:700 11px monospace}
    `;
    document.head.appendChild(style);
    const grid = document.getElementById('gallery-grid');
    for (const [index, gun] of guns.entries()) {
      const src = thumbs.renderWeaponSkinned(gun, null);
      if (!src) throw new Error(`no rendered model for ${gun.id}`);
      const card = document.createElement('article');
      card.className = 'card';
      card.innerHTML = `<img alt="${gun.name}" src="${src}"><div class="label"><span class="num">${String(index + 1).padStart(2, '0')}</span><span class="name">${gun.name.toUpperCase()}</span><span class="id">${gun.id}</span></div>`;
      grid.appendChild(card);
    }
    return guns.length;
  });
  await page.screenshot({ path: output, fullPage: true });
  console.log(`weapon gallery captured: ${count} production gun models -> ${output}`);
} finally {
  await browser.close();
}
