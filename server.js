const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pipeline } = require('stream');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.mjs': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml'
};

const COMPRESSIBLE = new Set([
  'text/html; charset=UTF-8',
  'application/javascript; charset=UTF-8',
  'application/json; charset=UTF-8',
  'text/css; charset=UTF-8',
  'image/svg+xml'
]);

// Memory cache for small frequently accessed files
const memoryCache = new Map();
const MAX_CACHE_SIZE = 100 * 1024; // 100 KB max per file

const server = http.createServer((req, res) => {
  const cleanUrl = req.url.split('?')[0].split('#')[0];
  let filePath = path.join(ROOT, cleanUrl === '/' ? 'index.html' : cleanUrl);

  // If directory, serve directory/index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  // If path doesn't have extension and file exists as .html
  if (!fs.existsSync(filePath) && fs.existsSync(filePath + '.html')) {
    filePath = filePath + '.html';
  }

  // Smart WebP negotiation: if client supports webp and request is for .jpg/.jpeg, check for .webp
  const acceptHeader = req.headers.accept || '';
  if (acceptHeader.includes('image/webp') && /\.(jpe?g)$/i.test(filePath)) {
    const webpCandidate = filePath.replace(/\.(jpe?g)$/i, '.webp');
    if (fs.existsSync(webpCandidate)) {
      filePath = webpCandidate;
    }
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=UTF-8' });
    res.end('<h1>404 Not Found</h1><p>TORQ CLUB — Page not found.</p>');
    return;
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  // Generate ETag from mtime and size
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, {
      'ETag': etag,
      'Cache-Control': ext === '.html' ? 'public, max-age=600' : 'public, max-age=31536000, immutable'
    });
    res.end();
    return;
  }

  // Headers
  const headers = {
    'Content-Type': mimeType,
    'ETag': etag,
    'Access-Control-Allow-Origin': '*',
    'Vary': 'Accept-Encoding, Accept'
  };

  // Caching policy: aggressive for static assets, moderate for HTML
  if (ext === '.html') {
    headers['Cache-Control'] = 'public, max-age=600, stale-while-revalidate=86400';
  } else {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  }

  // Compression check for compressible text/code
  const isCompressible = COMPRESSIBLE.has(mimeType);
  const acceptEncoding = req.headers['accept-encoding'] || '';

  if (isCompressible) {
    let compressStream = null;
    if (/\bgzip\b/.test(acceptEncoding)) {
      headers['Content-Encoding'] = 'gzip';
      compressStream = zlib.createGzip({ level: 6 });
    } else if (/\bdeflate\b/.test(acceptEncoding)) {
      headers['Content-Encoding'] = 'deflate';
      compressStream = zlib.createDeflate();
    }

    res.writeHead(200, headers);
    const readStream = fs.createReadStream(filePath);

    if (compressStream) {
      pipeline(readStream, compressStream, res, (err) => {
        if (err && !res.headersSent) res.end();
      });
    } else {
      pipeline(readStream, res, (err) => {
        if (err && !res.headersSent) res.end();
      });
    }
  } else {
    // Binary/image streaming
    headers['Content-Length'] = stat.size;
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  }
});

server.listen(PORT, () => {
  console.log(`⚡ High-Performance TORQ CLUB server running at http://localhost:${PORT}`);
  console.log(`🚀 Gzip streaming enabled | WebP auto-negotiation enabled | Immutable caching active`);
});
