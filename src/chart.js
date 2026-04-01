const puppeteer = require('puppeteer');
const fs = require('fs');

/**
 * Extracts the current price value of a ticker.
 */
async function getTickerValue(ticker) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const url = `https://www.google.com/finance/quote/${ticker}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Google Finance uses a div with an attribute that usually starts with 'data-last-price' 
    // or a specific class for the big price.
    // This selector targets the main price display area.
    const priceSelector = '[data-last-price]';
    
    await page.waitForSelector(priceSelector, { timeout: 10000 });

    const price = await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      return element ? element.getAttribute('data-last-price') || element.innerText : null;
    }, priceSelector);

    return price;

  } catch (error) {
    console.error(`Error fetching value for ${ticker}:`, error.message);
    return null;
  } finally {
    await browser.close();
  }
}

async function getTickerScreenshot(ticker) {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1200 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    const url = `https://www.google.com/finance/quote/${ticker}`;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Cookie Consent Logic
    try {
      const buttons = await page.$$('button');
      for (const button of buttons) {
        const text = await page.evaluate(el => el.innerText, button);
        if (text.includes('Accept') || text.includes('Agree')) {
          await button.click();
          await new Promise(r => setTimeout(r, 2000));
          break;
        }
      }
    } catch (e) {}

    await page.waitForFunction(() => document.body.innerText.length > 100);

    const screenshot = await page.screenshot({
      encoding: 'binary',
      type: 'png',
      clip: { x: 100, y: 150, width: 730, height: 500 }
    });

    return screenshot;
  } catch (error) {
    throw error;
  } finally {
    await browser.close();
  }
}

// --- CLI / BATCH EXECUTION BLOCK ---
if (require.main === module) {
  const arg = process.argv[2];
  let tickersToProcess = [];

  if (arg) {
    tickersToProcess = [arg];
  } else {
    const defaultUrls = [
      'https://www.google.com/finance/beta/quote/.INX:INDEXSP',
      'https://www.google.com/finance/beta/quote/BZW00:NYMEX',
      'https://www.google.com/finance/beta/quote/CLW00:NYMEX',
      'https://www.google.com/finance/beta/quote/KOSPI:KRX',
      'https://www.google.com/finance/beta/quote/000300:SHA',
      'https://www.google.com/finance/beta/quote/NIFTY_50:INDEXNSE'
    ];
    tickersToProcess = defaultUrls.map(url => url.split('/').pop());
  }

  (async () => {
    for (const ticker of tickersToProcess) {
      try {
        console.log(`Processing: ${ticker}`);
        
        // Get the Value
        const value = await getTickerValue(ticker);
        console.log(`Current Price for ${ticker}: ${value}`);

        // Get the Screenshot
        const buffer = await getTickerScreenshot(ticker);
        const fileName = `chart_${ticker.replace(/[:\/]/g, '_')}.png`;
        fs.writeFileSync(fileName, buffer);
        
        console.log(`Successfully saved: ${fileName}`);
      } catch (err) {
        console.error(`Failed to process ${ticker}: ${err.message}`);
      }
    }
    console.log('Done.');
  })();
}

module.exports = { getTickerScreenshot, getTickerValue };
