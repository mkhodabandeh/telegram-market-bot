require('dotenv').config({
  path: process.env.DOTENV_CONFIG_PATH || undefined,
  override: false,
});
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const fs = require('fs');
const { getTickerScreenshot, getTickerValue, closeBrowser } = require('./chart');

// --- 1. CONFIGURATION & STATE ---
const token = process.env.TELEGRAM_BOT_TOKEN;
const IS_LOCAL = process.env.LOCAL_MODE === 'true';
const PORT = parseInt(process.env.PORT, 10) || 3000;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;
const WEBHOOK_URL = process.env.TELEGRAM_WEBHOOK_URL || RENDER_EXTERNAL_URL || '';
const WEBHOOK_PATH = process.env.TELEGRAM_WEBHOOK_PATH || `/telegram/webhook/${token}`;
const USE_WEBHOOK = !IS_LOCAL && Boolean(WEBHOOK_URL);

if (!token) {
  console.error('TELEGRAM_BOT_TOKEN is not set.');
  process.exit(1);
}

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
let trackerRunInProgress = false;

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

const bot = IS_LOCAL
  ? null
  : new TelegramBot(token, USE_WEBHOOK ? {} : { polling: true });
const app = express();

app.use(express.json());

app.get('/ping', (_req, res) => {
  res.status(204).end();
});

app.get('/', (_req, res) => {
  res.type('text/plain').send('Telegram Market Bot is running');
});

app.post(WEBHOOK_PATH, (req, res) => {
  if (!bot || !USE_WEBHOOK) {
    return res.status(404).end();
  }

  bot.processUpdate(req.body);
  return res.status(200).end();
});

app.listen(PORT, async () => {
  console.log(`HTTP server listening on port ${PORT}`);

  if (!bot || !USE_WEBHOOK) {
    if (!IS_LOCAL) {
      console.log('Telegram transport: polling');
    }
    return;
  }

  const normalizedBaseUrl = WEBHOOK_URL.replace(/\/+$/, '');
  const webhookUrl = `${normalizedBaseUrl}${WEBHOOK_PATH}`;

  try {
    await bot.setWebHook(webhookUrl);
    console.log(`Telegram transport: webhook (${webhookUrl})`);
  } catch (error) {
    console.error(`Failed to set webhook: ${error.message}`);
    process.exit(1);
  }
});

// --- 2. CORE LOGIC ---

function saveState() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(userSettings, null, 2));
  fs.writeFileSync(PRICE_CACHE_FILE, JSON.stringify(lastPublishedPrices, null, 2));
}

function logMemoryUsage(context) {
  const toMb = bytes => `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  const usage = process.memoryUsage();
  console.log(
    `[memory] ${context} rss=${toMb(usage.rss)} heapUsed=${toMb(usage.heapUsed)} heapTotal=${toMb(usage.heapTotal)} external=${toMb(usage.external)}`
  );
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
    let photo = null;

    try {
      photo = await getTickerScreenshot(ticker);
    } catch (e) {
      console.error(`Failed to capture chart for ${ticker}:`, e.message);
      return;
    }
    
    for (const chatId of subscribers) {
      try {
        await bot.sendPhoto(
          chatId,
          photo,
          {
            caption: message,
            parse_mode: 'Markdown'
          },
          {
            filename: `chart_${ticker.replace(/[^a-zA-Z0-9._-]/g, '_')}.png`,
            contentType: 'image/png'
          }
        );
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
  if (trackerRunInProgress) {
    console.warn('Skipping tracker run because the previous cycle is still in progress.');
    logMemoryUsage('skip-overlap');
    return;
  }

  trackerRunInProgress = true;
  const { threshold, tickers } = userSettings.global;
  console.log(`\n--- Check started at ${new Date().toLocaleTimeString()} (Threshold: ${threshold}%) ---`);
  logMemoryUsage('before-run');

  try {
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
  } finally {
    trackerRunInProgress = false;
    logMemoryUsage('after-run');
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

  bot.onText(/\/stop/, (msg) => {
    if (userSettings[msg.chat.id]) {
      delete userSettings[msg.chat.id];
      saveState();
    }

    bot.sendMessage(
      msg.chat.id,
      "🛑 *Market Watcher Bot Stopped*\n\nYou will no longer receive alerts. Use `/start` to subscribe again.",
      { parse_mode: 'Markdown' }
    );
  });
}

// --- 4. EXECUTION ---
startTracker();

// In local mode, we usually want an immediate first run to see results
if (IS_LOCAL) {
  runTracker();
}

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down.`);
  if (activeTrackerJob) {
    activeTrackerJob.stop();
  }
  await closeBrowser().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});
