require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const express = require('express');
const fs = require('fs');
const { getOilData } = require('./oilData');
const { generateChartUrl } = require('./chart');
const { stitchChartsInGrid } = require('./subplots');
const packageJson = require('../package.json');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set in .env");
  process.exit(1);
}

// Start the web server immediately so Render health checks and external pings
// succeed even while the Telegram bot finishes initializing on cold starts.
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.type('text/plain').send('Telegram Market Bot is running');
});

app.get('/ping', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(204).end();
});

app.head('/ping', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.status(204).end();
});

app.listen(port, () => {
  console.log(`Express web server listening on port ${port}`);
});

const bot = new TelegramBot(token, { polling: true });

// Simple file-based subscription management
const SUBSCRIPTIONS_FILE = './subscriptions.json';
const SETTINGS_FILE = './settings.json';
// subscriptions: Map<chatId, { interval: string, cronJob: CronJob }>
let subscriptions = new Map();
let userSettings = {};

/**
 * Parse an interval string like "4h", "30m", "2d" into a cron expression.
 * Supported units: m (minutes), h (hours), d (days).
 * Returns null if the interval is invalid or too short (< 1 min).
 */
function intervalToCron(intervalStr) {
  const match = intervalStr.match(/^(\d+)([mhd])$/);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2];
  if (value <= 0) return null;

  if (unit === 'm') {
    if (value < 1 || value > 59) return null;
    return `*/${value} * * * *`;
  } else if (unit === 'h') {
    if (value < 1 || value > 23) return null;
    return `0 */${value} * * *`;
  } else if (unit === 'd') {
    if (value < 1 || value > 30) return null;
    return `0 0 */${value} * *`;
  }
  return null;
}

if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
  try {
    const data = JSON.parse(fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8'));
    // data may be an array (legacy) or an object { chatId: interval }
    if (Array.isArray(data)) {
      // legacy: set with no interval → default 1h
      data.forEach(chatId => scheduleSubscription(chatId, '1h'));
    } else {
      Object.entries(data).forEach(([chatId, interval]) => scheduleSubscription(Number(chatId), interval));
    }
  } catch (err) {
    console.error("Error reading subscriptions file:", err);
  }
}

if (fs.existsSync(SETTINGS_FILE)) {
  try {
    const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
    userSettings = JSON.parse(data);
  } catch (err) {
    console.error("Error reading settings file:", err);
  }
}

function saveSubscriptions() {
  const data = {};
  for (const [chatId, { interval }] of subscriptions) {
    data[chatId] = interval;
  }
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(data));
}

function scheduleSubscription(chatId, interval) {
  // Cancel any existing job for this chat
  if (subscriptions.has(chatId)) {
    subscriptions.get(chatId).cronJob.stop();
  }
  const cronExpr = intervalToCron(interval);
  if (!cronExpr) return false;
  const job = cron.schedule(cronExpr, async () => {
    console.log(`Sending update to ${chatId} (interval: ${interval})`);
    await sendOilUpdate(chatId);
  });
  subscriptions.set(chatId, { interval, cronJob: job });
  return true;
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(userSettings));
}

const defaultTickers = ['CL=F', 'BZ=F', '^GSPC', '^N225', '^NSEI', '^KS11'];

function parseCommandArgs(argString) {
  if (!argString) return [];

  return argString
    .split(/[\s,]+/)
    .map(token => token.trim())
    .filter(Boolean);
}

async function sendOilUpdate(chatId) {
  try {
    bot.sendChatAction(chatId, 'typing');
    
    // Fetch settings for user
    const s = userSettings[chatId] || { days: 5, interval: '1d', tickers: defaultTickers };
    if (!s.tickers || s.tickers.length === 0) s.tickers = defaultTickers; // fallback
    
    let summaryMessage = `📈 *Current Prices:*\n_Range: ${s.days} days, Interval: ${s.interval}_\n\n`;
    let chartUrls = [];

    for (const ticker of s.tickers) {
      try {
        const { name, currentPrice, changePercent, historicalData } = await getOilData(ticker, s.days, s.interval);
        const displayName = `${name} (${ticker})`;
        const chartUrl = generateChartUrl(historicalData, s.days, s.interval, displayName);
        
        let changeStr = '';
        let emoji = '🔹';
        if (changePercent !== null && changePercent !== undefined) {
          const sign = changePercent > 0 ? '+' : '';
          emoji = changePercent >= 0 ? '🟢 📈' : '🔴 📉';
          changeStr = ` (${sign}${changePercent.toFixed(2)}%)`;
        }
        
        summaryMessage += `${emoji} *${displayName}*: $${currentPrice.toFixed(2)}${changeStr}\n`;
        chartUrls.push(chartUrl);
      } catch (err) {
        summaryMessage += `🔹 *${ticker}*: Error fetching data\n`;
        console.error(`Error for ${ticker}:`, err);
      }
    }
    
    await bot.sendMessage(chatId, summaryMessage, { parse_mode: 'Markdown' });
    
    if (chartUrls.length > 0) {
      bot.sendChatAction(chatId, 'upload_photo');
      try {
        const stitchedBuffer = await stitchChartsInGrid(chartUrls);
        if (stitchedBuffer) {
          await bot.sendPhoto(chatId, stitchedBuffer);
        }
      } catch (e) {
        console.error("Error generating subplots:", e);
        bot.sendMessage(chatId, "Failed to render subplots grid.");
      }
    }
  } catch (error) {
    console.error("Error sending market update:", error);
    bot.sendMessage(chatId, "Sorry, I couldn't fetch the latest data right now.");
  }
}

// Commands
bot.onText(/^\/(start|help)(?:@[\w_]+)?$/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMsg = `Welcome to the Market Price Bot! 📈\n\nCommands:\n/markets - Get current prices and charts\n/subscribe - Get an automatic update every hour\n/unsubscribe - Stop automatic hourly updates\n/set [days] [interval] - Customize the chart (e.g. \`/set 3 30m\` or \`/set 30 1d\`)\n/tickers [T1] [T2] - Set your preferred tickers (e.g. \`/tickers BZ=F CL=F GC=F\`)\n/version - Show the current bot version`;
  bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' });
});

bot.onText(/^\/version(?:@[\w_]+)?$/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `🤖 *Market Bot Version:* ${packageJson.version}`, { parse_mode: 'Markdown' });
});

bot.onText(/^\/markets(?:@[\w_]+)?$/, (msg) => {
  const chatId = msg.chat.id;
  sendOilUpdate(chatId);
});

bot.onText(/^\/subscribe(?:@[\w_]+)?(?:\s+(.+))?$/, (msg, match) => {
  const chatId = msg.chat.id;
  const intervalArg = (match[1] || '1h').trim();

  if (!intervalToCron(intervalArg)) {
    bot.sendMessage(chatId,
      "⚠️ Invalid interval. Use formats like `30m`, `4h`, `2d`.\nExample: `/subscribe 4h`",
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const ok = scheduleSubscription(chatId, intervalArg);
  if (!ok) {
    bot.sendMessage(chatId, "⚠️ Failed to schedule subscription.");
    return;
  }
  saveSubscriptions();
  bot.sendMessage(chatId, `✅ Subscribed! You will receive market updates every *${intervalArg}*.`, { parse_mode: 'Markdown' });
});

bot.onText(/^\/unsubscribe(?:@[\w_]+)?$/, (msg) => {
  const chatId = msg.chat.id;
  if (subscriptions.has(chatId)) {
    subscriptions.get(chatId).cronJob.stop();
    subscriptions.delete(chatId);
    saveSubscriptions();
  }
  bot.sendMessage(chatId, "❌ You have been unsubscribed from market updates.");
});

bot.onText(/^\/set(?:@[\w_]+)?(?:\s+(.+))?$/, (msg, match) => {
  const chatId = msg.chat.id;
  const args = parseCommandArgs(match[1]);
  
  if (args.length !== 2) {
    bot.sendMessage(chatId, "⚠️ Usage: `/set [days] [interval]`\nValid intervals: `1m, 2m, 5m, 15m, 30m, 60m, 90m, 1h, 1d, 5d, 1wk, 1mo, 3mo`\nExample: `/set 3 30m` defaults to 3 days at 30 min intervals.", { parse_mode: 'Markdown' });
    return;
  }
  
  const days = parseInt(args[0], 10);
  const interval = args[1];
  
  if (isNaN(days) || days <= 0 || days > 365) {
    bot.sendMessage(chatId, "⚠️ Please provide a valid number of days (1-365).");
    return;
  }
  
  if (!interval.match(/^\d+[mhd]$/) && !['1wk', '1mo', '3mo'].includes(interval)) {
    bot.sendMessage(chatId, "⚠️ Invalid interval. Use formats like `8h`, `2d`, `30m` or native `1wk`, `1mo`.", { parse_mode: 'Markdown' });
    return;
  }

  if (!userSettings[chatId]) userSettings[chatId] = { tickers: defaultTickers };
  userSettings[chatId].days = days;
  userSettings[chatId].interval = interval;
  saveSettings();
  
  bot.sendMessage(chatId, `✅ Settings updated!\nChart Range: **${days} days**\nData Interval: **${interval}**\nSend /markets to test it out.`, { parse_mode: 'Markdown' });
});

bot.onText(/^\/tickers?(?:@[\w_]+)?(?:\s+(.+))?$/, (msg, match) => {
  const chatId = msg.chat.id;
  const args = parseCommandArgs(match[1]);
  
  if (args.length === 0) {
    bot.sendMessage(chatId, "⚠️ Usage: `/tickers [TICKER1] [TICKER2] ...`\nExample: `/tickers BZ=F CL=F GC=F`", { parse_mode: 'Markdown' });
    return;
  }
  
  if (!userSettings[chatId]) userSettings[chatId] = { days: 5, interval: '1d' };
  userSettings[chatId].tickers = args;
  saveSettings();
  
  bot.sendMessage(chatId, `✅ Tickers updated to: **${args.join(', ')}**\nSend /markets to test.`, { parse_mode: 'Markdown' });
});

// Per-chat cron jobs are created in scheduleSubscription() — no global broadcast needed.

bot.setMyCommands([
  { command: 'markets', description: 'Get current prices and charts' },
  { command: 'subscribe', description: 'Subscribe to automatic updates' },
  { command: 'unsubscribe', description: 'Unsubscribe from updates' },
  { command: 'set', description: 'Customize chart range and interval' },
  { command: 'tickers', description: 'Set preferred market tickers' },
  { command: 'version', description: 'Show bot version' },
  { command: 'help', description: 'Show help message' }
]).then(() => {
  console.log("Bot commands registered.");
}).catch((err) => {
  console.error("Error registering bot commands:", err);
});

console.log("Bot is running...");
