// Loads the site in headless Chromium and fails on a JS error or a missing
// local file. Expects frontend/ to be served at BASE_URL.
import { chromium } from 'playwright';

const base = process.env.BASE_URL || 'http://localhost:8082';
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => errors.push(`JS error: ${e.message}`));
page.on('response', r => {
  if (r.url().startsWith(base) && r.status() >= 400 && !r.url().endsWith('favicon.ico')) {
    errors.push(`${r.status()} ${r.url()}`);
  }
});

await page.goto(base, { waitUntil: 'load' });
await page.waitForTimeout(5000);
await browser.close();

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('Smoke test passed.');
