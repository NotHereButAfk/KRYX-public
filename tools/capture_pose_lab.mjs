import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const url = process.argv[2] || 'http://127.0.0.1:5995/pose-lab.html';
const output = process.argv[3] || 'pose-lab.png';

mkdirSync(dirname(output), { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME || undefined,
  args: [
    '--use-gl=swiftshader', '--enable-webgl', '--no-sandbox',
    '--disable-dev-shm-usage', '--enable-unsafe-swiftshader',
  ],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 560 } });
await page.goto(url, { waitUntil: 'commit', timeout: 30000 });
await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 });
await page.waitForTimeout(180);
await page.screenshot({ path: output });
console.log(JSON.stringify(await page.evaluate(() => window.__probe)));
await browser.close();
