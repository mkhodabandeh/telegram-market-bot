const { Jimp } = require('jimp');

async function stitchChartsInGrid(urls) {
  if (!urls || urls.length === 0) return null;
  if (urls.length === 1) {
    const img = await Jimp.read(urls[0]);
    return await img.getBuffer('image/png');
  }
  
  // Read all images
  const images = await Promise.all(urls.map(url => Jimp.read(url)));
  
  // Determine layout
  const numCols = urls.length > 2 ? 2 : 1;
  const numRows = Math.ceil(images.length / numCols);
  
  const cellWidth = images[0].bitmap.width; 
  const cellHeight = images[0].bitmap.height;
  
  // Create blank canvas
  const out = new Jimp({ width: cellWidth * numCols, height: cellHeight * numRows, color: '#FFFFFF' });
  
  // Composite images into the canvas
  images.forEach((img, i) => {
    const x = (i % numCols) * cellWidth;
    const y = Math.floor(i / numCols) * cellHeight;
    out.composite(img, x, y);
  });
  
  return await out.getBuffer('image/png');
}

module.exports = { stitchChartsInGrid };
