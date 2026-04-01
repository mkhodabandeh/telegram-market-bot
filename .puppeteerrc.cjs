const { join } = require('path');

/**
 * Keep the browser cache inside the deployed project so build-time downloads
 * are available to the runtime container on Render.
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
