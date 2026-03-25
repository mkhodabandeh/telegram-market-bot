require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const fs = require('fs');
const { getOilData } = require('./oilData');
const { generateChartUrl } = require('./chart');
const { stitchChartsInGrid } = require('./subplots');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set in .env");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Simple file-based subscription management
const SUBSCRIPTIONS_FILE = './subscriptions.json';
const SETTINGS_FILE = './settings.json';
let subscriptions = new Set();
let userSettings = {};

if (fs.existsSync(SUBSCRIPTIONS_FILE)) {
  try {
    const data = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8');
    subscriptions = new Set(JSON.parse(data));
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
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(Array.from(subscriptions)));
}

function saveSettings() {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(userSettings));
}

const defaultTickers = ['CL=F', 'BZ=F', '^GSPC', '^N225', '^NSEI', '^KS11'];

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
bot.onText(/\/(start|help)/, (msg) => {
  const chatId = msg.chat.id;
  const welcomeMsg = `Welcome to the Market Price Bot! 📈\n\nCommands:\n/markets - Get current prices and charts\n/subscribe - Get an automatic update every hour\n/unsubscribe - Stop automatic hourly updates\n/set [days] [interval] - Customize the chart (e.g. \`/set 3 30m\` or \`/set 30 1d\`)\n/tickers [T1] [T2] - Set your preferred tickers (e.g. \`/tickers BZ=F CL=F NG=F\`)`;
  bot.sendMessage(chatId, welcomeMsg, { parse_mode: 'Markdown' });
});

bot.onText(/\/markets/, (msg) => {
  const chatId = msg.chat.id;
  sendOilUpdate(chatId);
});

bot.onText(/\/subscribe/, (msg) => {
  const chatId = msg.chat.id;
  subscriptions.add(chatId);
  saveSubscriptions();
  bot.sendMessage(chatId, "✅ You are now subscribed to hourly oil price updates!");
});

bot.onText(/\/unsubscribe/, (msg) => {
  const chatId = msg.chat.id;
  subscriptions.delete(chatId);
  saveSubscriptions();
  bot.sendMessage(chatId, "❌ You have been unsubscribed from hourly updates.");
});

bot.onText(/\/set ?(.*)?/, (msg, match) => {
  const chatId = msg.chat.id;
  const args = match[1] ? match[1].split(' ') : [];
  
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
  
  if (!['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo', '3mo'].includes(interval)) {
    bot.sendMessage(chatId, "⚠️ Invalid interval. See `/set` for valid options.", { parse_mode: 'Markdown' });
    return;
  }

  if (!userSettings[chatId]) userSettings[chatId] = { tickers: defaultTickers };
  userSettings[chatId].days = days;
  userSettings[chatId].interval = interval;
  saveSettings();
  
  bot.sendMessage(chatId, `✅ Settings updated!\nChart Range: **${days} days**\nData Interval: **${interval}**\nSend /markets to test it out.`, { parse_mode: 'Markdown' });
});

bot.onText(/\/tickers? ?(.*)?/, (msg, match) => {
  const chatId = msg.chat.id;
  const args = match[1] ? match[1].split(' ').filter(t => t.trim() !== '') : [];
  
  if (args.length === 0) {
    bot.sendMessage(chatId, "⚠️ Usage: `/tickers [TICKER1] [TICKER2] ...`\nExample: `/tickers BZ=F CL=F GC=F`", { parse_mode: 'Markdown' });
    return;
  }
  
  if (!userSettings[chatId]) userSettings[chatId] = { days: 5, interval: '1d' };
  userSettings[chatId].tickers = args;
  saveSettings();
  
  bot.sendMessage(chatId, `✅ Tickers updated to: **${args.join(', ')}**\nSend /markets to test.`, { parse_mode: 'Markdown' });
});

cron.schedule('0 * * * *', async () => {
  console.log('Running hourly market broadcast...');
  for (const chatId of subscriptions) {
    await sendOilUpdate(chatId);
  }
});

// Create a dummy web server so Render.com can bind a port for its "Web Service" Free Tier constraints
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Telegram Market Bot is running! 📈');
});

app.listen(port, () => {
  console.log(`Dummy Express web server listening on port ${port}`);
});

console.log("Bot is running...");
