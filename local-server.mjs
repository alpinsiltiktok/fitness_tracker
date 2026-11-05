import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler } from './netlify/functions/sheets.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4173);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);
  if (url.pathname === '/.netlify/functions/sheets') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const result = await handler({
      httpMethod: request.method,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: chunks.length ? Buffer.concat(chunks).toString('utf8') : null,
    });
    response.writeHead(result.statusCode, result.headers);
    response.end(result.body);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }

  const relativePath = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const filePath = path.resolve(root, `.${relativePath}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : file);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'EISDIR') {
      console.error('Local fitness tracker server error:', error);
    }
    response.writeHead(error.code === 'ENOENT' ? 404 : 500);
    response.end(error.code === 'ENOENT' ? 'Not found' : 'Internal server error');
  }
});

server.listen(port, host, () => {
  console.log(`Fitness tracker ready at http://${host}:${port}`);
  if (!process.env.FITNESS_TRACKER_GAS_URL || !process.env.FITNESS_TRACKER_API_KEY) {
    console.warn('Google Sheets sync is not configured. Set FITNESS_TRACKER_GAS_URL and FITNESS_TRACKER_API_KEY.');
  }
});
