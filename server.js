// server.js — zero-dependency local server.
// Fetches Desmos data server-side (no CORS restriction applies server-to-server),
// then serves the tool page which calls this server instead of Desmos directly.
//
// Run with:  node server.js
// Then open: http://localhost:8787

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 8787;

function fetchUrl(targetUrl, headers = {}, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(targetUrl); } catch (e) { reject(new Error('Invalid URL')); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(
      u,
      { headers: Object.assign({ 'User-Agent': 'Mozilla/5.0' }, headers) },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          const next = new URL(res.headers.location, u).toString();
          res.resume();
          fetchUrl(next, headers, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
        );
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);

  // Server-side fetch of the Desmos graph JSON — no CORS applies here.
  if (parsed.pathname === '/api/desmos') {
    const target = parsed.searchParams.get('url');
    if (!target) { res.writeHead(400); res.end('missing url param'); return; }
    try {
      const result = await fetchUrl(target, { Accept: 'application/json' });
      res.writeHead(result.statusCode, { 'Content-Type': 'application/json' });
      res.end(result.body);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Server-side fetch of the image — sidesteps canvas CORS-taint issues too.
  if (parsed.pathname === '/api/image') {
    const target = parsed.searchParams.get('url');
    if (!target) { res.writeHead(400); res.end('missing url param'); return; }
    try {
      const result = await fetchUrl(target);
      res.writeHead(result.statusCode, {
        'Content-Type': result.headers['content-type'] || 'image/png',
      });
      res.end(result.body);
    } catch (err) {
      res.writeHead(502);
      res.end('image fetch failed: ' + err.message);
    }
    return;
  }

  // Static file serving (just index.html in this folder)
  let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
  filePath = path.join(__dirname, filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Desmos → G-code tool running at http://localhost:${PORT}`);
});
