require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const fs = require('fs');
const { getTickerScreenshot, getTickerValue } = require('./chart');

// --- 1. CONFIGURATION & STATE ---
const token = process.env.TELEGRAM_BOT_TOKEN;
const IS_LOCAL = process.env.LOCAL_MODE === 'true';

// Priority: Command Line Arg > .env/Hardcoded Defaults
const cmdInterval = parseInt(process.env.DEFAULT_INTERVAL) || 10;
const cmdThreshold = parseFloat(process.env.DEFAULT_THRESHOLD) || 1.0;

const SETTINGS_FILE = './settings.json';
const PRICE_CACHE_FILE = './price_cache.json';

// Initialize state
let userSettings = {
  global: {
    interval: cmdInterval,
    threshold: cmdThreshold,
    tickers: ['.INX:INDEXSP', 'BZW00:NYMEX', 'CLW00:NYMEX', 'KOSPI:KRX', '000300:SHA', 'NIFTY_50:INDEXNSE']
  }
};

let lastPublishedPrices = {};
let activeTrackerJob = null;

// Load persisted data (overwrites defaults if files exist)
if (fs.existsSync(SETTINGS_FILE)) {
  try {
    const savedSettings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    // If running in LOCAL mode, we prioritize the CMD args over the saved JSON
    userSettings = IS_LOCAL ? { ...savedSettings, global: userSettings.global } : savedSettings;
  } catch (e) {
    console.error("Error parsing settings.json, using defaults.");
  }
}

if (fs.existsSync(PRICE_CACHE_FILE)) {
  try {
    lastPublishedPrices = JSON.parse(fs.readFileSync(PRICE_CACHE_FILE, 'utf8'));
  } catch (e) {
    console.error("Error parsing price_cache.json.");
  }
}

const bot = IS_LOCAL ? null : new TelegramBot(token, { polling: true });

// --- 2. CORE LOGIC ---

function saveState() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(userSettings, null, 2));
  fs.writeFileSync(PRICE_CACHE_FILE, JSON.stringify(lastPublishedPrices, null, 2));
}

/**
 * Sends to Telegram or Logs to Console
 */
async function dispatchUpdate(ticker, oldPrice, newPrice, percentChange) {
  const direction = newPrice > oldPrice ? "increased" : "decreased";
  const absPercent = Math.abs(percentChange).toFixed(4); // Higher precision for small thresholds
  const message = `🔔 ${ticker} has ${direction} by ${absPercent}%\n💰 Previous: $${oldPrice} | Current: $${newPrice}`;

  if (IS_LOCAL) {
    console.log(`\n[LOCAL OUTPUT]`);
    console.log(`TEXT: ${message}`);
    console.log(`IMAGE: Capturing ${ticker} chart...`);
    try {
      await getTickerScreenshot(ticker);
      console.log(`[LOCAL] Chart for ${ticker} captured and saved to disk.`);
    } catch (e) {
      console.error(`[LOCAL] Failed to capture chart: ${e.message}`);
    }
  } else {
    // Send to all registered users
    const subscribers = Object.keys(userSettings).filter(id => id !== 'global');
    
    for (const chatId of subscribers) {
      try {
        const photo = await getTickerScreenshot(ticker);
        await bot.sendPhoto(chatId, photo, { 
            caption: message,
            parse_mode: 'Markdown' 
        });
      } catch (e) {
        console.error(`Failed to send to ${chatId}:`, e.message);
      }
    }
  }
}

/**
 * The Tracking Engine
 */
async function runTracker() {
  const { threshold, tickers } = userSettings.global;
  console.log(`\n--- Check started at ${new Date().toLocaleTimeString()} (Threshold: ${threshold}%) ---`);

  for (const ticker of tickers) {
    try {
      console.log(`Processing: ${ticker}...`);
      const rawValue = await getTickerValue(ticker);
      if (!rawValue) {
        console.log(`   ⚠️ No value returned for ${ticker}`);
        continue;
      }

      const currentPrice = parseFloat(rawValue.replace(/,/g, ''));
      const previousPrice = lastPublishedPrices[ticker] || 0;

      // First run for a ticker: just save the price
      if (previousPrice === 0) {
        console.log(`   ✨ Initializing ${ticker} at $${currentPrice}`);
        lastPublishedPrices[ticker] = currentPrice;
        saveState();
        continue;
      }

      const diffPercent = ((currentPrice - previousPrice) / previousPrice) * 100;
      
      console.log(`   🔍 ${ticker}: $${currentPrice} (Change: ${diffPercent.toFixed(4)}%)`);

      if (Math.abs(diffPercent) >= threshold) {
        await dispatchUpdate(ticker, previousPrice, currentPrice, diffPercent);
        lastPublishedPrices[ticker] = currentPrice;
        saveState();
      }
    } catch (err) {
      console.error(`   ❌ Tracker error for ${ticker}:`, err.message);
    }
  }
}

/**
 * Start/Restart the Scheduler
 */
function startTracker() {
  if (activeTrackerJob) activeTrackerJob.stop();
  
  const minutes = userSettings.global.interval;
  // Cron syntax for "every X minutes"
  activeTrackerJob = cron.schedule(`*/${minutes} * * * *`, runTracker);
  console.log(`Tracker active: Checking every ${minutes} minute(s) at ${userSettings.global.threshold}% threshold.`);
}

// --- 3. TELEGRAM COMMANDS ---
if (!IS_LOCAL && bot) {
  bot.onText(/\/config (\d+) (\d+\.?\d*)/, (msg, match) => {
    const minutes = parseInt(match[1]);
    const threshold = parseFloat(match[2]);

    userSettings.global.interval = minutes;
    userSettings.global.threshold = threshold;
    saveState();
    
    startTracker();
    bot.sendMessage(msg.chat.id, `✅ *Configuration Updated*\nInterval: ${minutes}m\nThreshold: ${threshold}%`, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/start/, (msg) => {
    if (!userSettings[msg.chat.id]) {
      userSettings[msg.chat.id] = { active: true };
      saveState();
    }
    bot.sendMessage(msg.chat.id, "📈 *Market Watcher Bot Started*\n\nI will alert you when markets move.\nUse `/config [min] [%]` to adjust settings.", { parse_mode: 'Markdown' });
  });
}

// --- 4. EXECUTION ---
startTracker();

// In local mode, we usually want an immediate first run to see results
if (IS_LOCAL) {
  runTracker();
}
