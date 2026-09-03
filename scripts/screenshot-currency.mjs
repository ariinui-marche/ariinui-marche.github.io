import { chromium } from 'playwright';

const SITE_URL = 'https://ariinui-marche.github.io/';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID env var');
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
await page.goto(SITE_URL, { waitUntil: 'networkidle' });

await page.click('#currencyToggle');
try {
  await page.waitForSelector('#currencyGrid .currency-card', { timeout: 15000 });
} catch {
  console.warn('Currency data did not load in time — sending current state anyway');
}
// let bar-fill widths/colors settle after render
await page.waitForTimeout(500);

const section = page.locator('xpath=//h2[@id="currencyToggle"]/parent::section');
const buffer = await section.screenshot();
await browser.close();

const hstDateStr = new Date(Date.now() - 10 * 3600 * 1000).toISOString().slice(0, 10);

const form = new FormData();
form.append('chat_id', CHAT_ID);
form.append('caption', `Currency Strength — ${hstDateStr}`);
form.append('photo', new Blob([buffer], { type: 'image/png' }), 'currency-strength.png');

const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
  method: 'POST',
  body: form,
});
const json = await res.json();
if (!json.ok) {
  console.error('Telegram send failed:', json);
  process.exit(1);
}
console.log('Sent to Telegram, message_id:', json.result.message_id);
