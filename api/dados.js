import crypto from 'node:crypto';
import { dados, resolverPeriodo, Erro } from '../lib/meta.js';

function senhaOk(req) {
  const esperada = process.env.DASH_SENHA;
  if (!esperada) return true;
  const a = Buffer.from(String(req.headers['x-dash-senha'] || ''));
  const b = Buffer.from(esperada);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  const enviar = (status, corpo, cache) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', cache || 'no-store');
    res.end(JSON.stringify(corpo));
  };
  try {
    if (!senhaOk(req)) return enviar(401, { erro: 'Senha incorreta.' });
    const q = Object.fromEntries(new URL(req.url, 'http://local').searchParams);
    const d = await dados(resolverPeriodo(q));
    // Sem senha, a CDN do Vercel também guarda a resposta por 30 min.
    enviar(200, d, process.env.DASH_SENHA ? 'private, no-store' : 's-maxage=1800, stale-while-revalidate=300');
  } catch (e) {
    if (!(e instanceof Erro)) console.error(e);
    enviar(e instanceof Erro ? e.status : 500, { erro: e instanceof Erro ? e.message : 'Erro interno.' });
  }
}
