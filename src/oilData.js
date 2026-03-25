const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// Apply a standard browser User-Agent to bypass Yahoo Finance's 429 / WAF blocks on Data Center IPs like Render.com
yahooFinance.setGlobalConfig({
  fetchOptions: {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }
  }
});

async function getOilData(ticker, days = 5, interval = '1d') {
  try {
    // Get current price
    const quote = await yahooFinance.quote(ticker);
    const currentPrice = quote.regularMarketPrice;
    const changePercent = quote.regularMarketChangePercent;
    const name = quote.shortName || quote.longName || ticker;

    // Get historical data bounds based on days argument
    const queryOptions = { 
      period1: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0], 
      interval: interval 
    };
    const chartData = await yahooFinance.chart(ticker, queryOptions);
    
    // Filter out null closes
    let quotes = chartData.quotes.filter(q => q.close !== null);

    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const formattedQuotes = quotes.map(data => {
      const d = data.date;
      if (['1d', '1wk', '1mo'].includes(interval)) {
        return { date: `${daysOfWeek[d.getDay()]} (${d.getMonth()+1}/${d.getDate()})`, close: data.close };
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
