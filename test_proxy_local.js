process.env.PROXY_URL = 'http://localhost:8080/?url=';

const { getOilData } = require('./src/oilData');

async function run() {
  try {
    const data = await getOilData('CL=F');
    console.log("Success:", data.currentPrice);
  } catch (err) {
    console.error("Test failed:", err.message);
  }
}

run();
