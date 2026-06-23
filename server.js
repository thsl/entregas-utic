const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const vm = require('vm');

const ROOT_DIR = __dirname;
const DATA_FILE = path.join(ROOT_DIR, 'data', 'entregas.json');
const DEFAULT_DATA_SCRIPT = path.join(ROOT_DIR, 'entregas-data.js');
const PORT = Number(process.env.PORT || 8787);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function ensureDataFile() {
  if (fs.existsSync(DATA_FILE)) return;
  const code = fs.readFileSync(DEFAULT_DATA_SCRIPT, 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(code, context);
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(context.window.DEFAULT_UNITS_DATA || [], null, 2));
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': MIME_TYPES['.json'] });
  res.end(JSON.stringify(data, null, 2));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
        reject(new Error('Payload muito grande.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function isValidContent(data) {
  return Array.isArray(data) && data.every(unit =>
    unit &&
    typeof unit.sigla === 'string' &&
    typeof unit.name === 'string' &&
    typeof unit.desc === 'string' &&
    Array.isArray(unit.timeline)
  );
}

async function handleApi(req, res, pathname) {
  if (pathname !== '/api/content') return false;

  ensureDataFile();

  if (req.method === 'GET') {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    sendJson(res, 200, JSON.parse(raw));
    return true;
  }

  if (req.method === 'POST') {
    try {
      const rawBody = await readRequestBody(req);
      const payload = JSON.parse(rawBody || 'null');
      if (!isValidContent(payload)) {
        sendJson(res, 400, { error: 'Estrutura de conteúdo inválida.' });
        return true;
      }
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2));
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Falha ao salvar conteúdo.' });
    }
    return true;
  }

  sendJson(res, 405, { error: 'Método não permitido.' });
  return true;
}

function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Arquivo não encontrado.');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url || '/');
  const pathname = decodeURIComponent(parsedUrl.pathname || '/');

  if (await handleApi(req, res, pathname)) return;

  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT_DIR, safePath);

  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Acesso negado.');
    return;
  }

  let finalPath = filePath;
  if (fs.existsSync(finalPath) && fs.statSync(finalPath).isDirectory()) {
    finalPath = path.join(finalPath, 'index.html');
  }
  serveStaticFile(res, finalPath);
});

server.listen(PORT, () => {
  console.log(`Servidor iniciado em http://127.0.0.1:${PORT}`);
});
