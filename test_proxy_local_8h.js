

const { getOilData } = require('./src/oilData');

async function run() {
  try {
    const data = await getOilData('CL=F', 5, '8h');
    console.log("Success:", data.currentPrice, "Samples:", data.historicalData.length);
  } catch (err) {
    console.error("Test failed:", err.message);
  }
}

run();
