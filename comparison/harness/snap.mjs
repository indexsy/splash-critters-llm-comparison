// Screenshot a running game: title screen, then whatever follows a keypress.
import { createRequire } from "module";
const require = createRequire("/Users/jackychou/dondi/package.json");
const { chromium } = require("playwright");

const [port, titleOut, actionOut] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 940 } });
try {
  await page.goto(`http://localhost:${port}/`, { timeout: 8000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: titleOut });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  await page.mouse.click(550, 470); // center-ish, in case it wants a click
  await page.waitForTimeout(1200);
  await page.screenshot({ path: actionOut });
  console.log("snap ok");
} finally {
  await browser.close();
}
