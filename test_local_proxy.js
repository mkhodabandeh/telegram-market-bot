const express = require('express');
const fetch = require('node-fetch');
const app = express();

app.use(async (req, res) => {
  const urlText = req.query.url;
  if (!urlText) return res.status(400).send("No url field");

  console.log("Proxying: ", urlText);
  const myHeaders = { ...req.headers };
  delete myHeaders.host;
  delete myHeaders.origin;
  delete myHeaders.referer;
  
  try {
    const response = await fetch(urlText, {
      method: req.method,
      headers: myHeaders,
      redirect: "follow" // node-fetch does this
    });

    const bodyChunks = [];
    for await (const chunk of response.body) {
        bodyChunks.push(chunk);
    }
    const bodyObj = Buffer.concat(bodyChunks);

    response.headers.forEach((val, key) => {
      if (key.toLowerCase() !== 'set-cookie') {
        res.setHeader(key, val);
      }
    });
    res.status(response.status).send(bodyObj);
  } catch (e) {
    console.error(e);
    res.status(500).send(e.message);
  }
});

app.listen(8080, () => {
  console.log('Test proxy listening on 8080');
});
