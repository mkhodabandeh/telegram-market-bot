const QuickChart = require('quickchart-js');

function generateChartUrl(historicalData, days, interval, ticker) {
  const chart = new QuickChart();
  
  const labels = historicalData.map(d => d.date);
  const data = historicalData.map(d => d.close);

  const minPrice = Math.min(...data);
  const maxPrice = Math.max(...data);
  const padding = (maxPrice - minPrice) * 0.1 || 1;

  chart.setConfig({
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: `${ticker} (USD)`,
        data: data,
        fill: false,
        borderColor: 'rgb(75, 192, 192)',
        tension: 0.1,
        pointRadius: data.length > 50 ? 0 : 3
      }]
    },
    options: {
      title: {
        display: true,
        text: `${ticker} - Last ${days} Days (${interval})`
      },
      legend: { display: false },
      scales: {
        yAxes: [{
          ticks: {
            suggestedMin: minPrice - padding,
            suggestedMax: maxPrice + padding
          }
        }],
        xAxes: [{
          ticks: {
            autoSkip: true,
            maxTicksLimit: 10
          }
        }]
      }
    }
  });

  chart.setWidth(800);
  chart.setHeight(400);
  chart.setBackgroundColor('white');

  return chart.getUrl();
}

module.exports = { generateChartUrl };
