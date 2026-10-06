// Servidor local (e de VPS) — no Vercel quem atende é api/dados.js + public/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const env = path.join(raiz, '.env');
if (fs.existsSync(env)) {
  for (const l of fs.readFileSync(env, 'utf8').split('\n')) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const { default: api } = await import('./api/dados.js');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://local');
  if (u.pathname === '/api/dados') return api(req, res);
  const pub = path.join(raiz, 'public');
  const arq = path.normalize(path.join(pub, u.pathname === '/' ? 'index.html' : u.pathname));
  if (!arq.startsWith(pub + path.sep) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.statusCode = 404; return res.end('Não encontrado'); }
  res.setHeader('Content-Type', TIPOS[path.extname(arq)] || 'application/octet-stream');
  fs.createReadStream(arq).pipe(res);
}).listen(process.env.PORT || 3000, () => console.log(`Dashboard em http://localhost:${process.env.PORT || 3000}`));
