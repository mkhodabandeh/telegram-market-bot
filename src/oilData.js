const YahooFinance = require('yahoo-finance2').default;

const originalFetch = global.fetch || require('node-fetch');

async function customFetch(url, options) {
  const proxyUrlStr = process.env.PROXY_URL;
  if (proxyUrlStr) {
    const proxyUrl = proxyUrlStr + encodeURIComponent(url);
    return originalFetch(proxyUrl, options);
  } else {
    return originalFetch(url, options);
  }
}

// Apply proxy custom fetch to bypass Yahoo Finance's 429 WAF blocks on Data Center IPs
const yahooFinance = new YahooFinance({
  fetch: customFetch,
  suppressNotices: ['yahooSurvey'],
  fetchOptions: {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }
  }
});

async function getOilData(ticker, days = 5, interval = '1d') {
  try {
    let baseInterval = interval;
    let downsampleTarget = null;
    let match = interval.match(/^(\d+)([mhd])$/);
    let intervalMinutes = 0;

    if (match) {
      const num = parseInt(match[1], 10);
      const unit = match[2];
      
      if (unit === 'd') {
        baseInterval = '1d';
        if (num > 1) downsampleTarget = num;
        intervalMinutes = num * 1440;
      } else if (unit === 'h') {
        baseInterval = '1h';
        if (num > 1) downsampleTarget = num;
        intervalMinutes = num * 60;
      } else if (unit === 'm') {
        const validM = [90, 60, 30, 15, 5, 2, 1];
        for (let m of validM) {
          if (num % m === 0) {
            baseInterval = `${m}m`;
            if (num > m) downsampleTarget = num / m;
            break;
          }
        }
        intervalMinutes = num;
      }
    } else {
      // Handle native Yahoo intervals that don't match the \d+[mhd] pattern
      if (interval === '1wk') intervalMinutes = 10080;
      else if (interval === '1mo') intervalMinutes = 43200;
      else if (interval === '3mo') intervalMinutes = 129600;
    }
    
    // Get historical data bounds based on days argument
    const queryOptions = { 
      period1: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0], 
      interval: baseInterval 
    };
    
    // We use chart() instead of quote() because quote() requires Set-Cookie/crumb headers
    // which are often stripped by proxies like Cloudflare Workers. chart() returns all needed info in meta.
    const chartData = await yahooFinance.chart(ticker, queryOptions);
    
    const meta = chartData.meta;
    const currentPrice = meta.regularMarketPrice;
    
    let changePercent = null;
    if (meta.chartPreviousClose) {
      changePercent = ((currentPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100;
    }
    
    const name = meta.shortName || meta.longName || meta.symbol || ticker;
    
    // Filter out null closes
    let quotes = chartData.quotes.filter(q => q.close !== null);
    
    // Downsample if required to build the target interval
    if (downsampleTarget && downsampleTarget > 1) {
      const downsampledQuotes = [];
      // Step backwards so the most recent data point is always included perfectly at the edge
      for (let i = quotes.length - 1; i >= 0; i -= downsampleTarget) {
        downsampledQuotes.unshift(quotes[i]);
      }
      quotes = downsampledQuotes;
    }

    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const formattedQuotes = quotes.map(data => {
      const d = data.date;
      // If interval is 1 day or more, use only date/day labels
      if (intervalMinutes >= 1440) {
        return { date: `${shortDays[d.getDay()]} ${d.getMonth()+1}/${d.getDate()}`, close: data.close };
      } else {
        const time = d.toISOString().split('T')[1].substring(0, 5);
        return { date: `${shortDays[d.getDay()]} ${time}`, close: data.close };
      }
    });

    return {
      name,
      currentPrice,
      changePercent,
      historicalData: [...formattedQuotes, { date: 'Now', close: currentPrice }]
    };
  } catch (error) {
    console.error('Error fetching oil data:', error);
    throw error;
  }
}

module.exports = { getOilData };
