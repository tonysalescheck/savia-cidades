// Leads do Kommo (somente leitura) ligados à cidade pelo utm_term, que traz o nome do conjunto.
// Regra de contagem: card criado no Funil de qualificação, Fonte do Lead = Meta Ads,
// Empreendimento = Savia. Qualificado = status 142 nesse funil. Só sai agregado, sem dado pessoal.
import { cidadeDoConjunto, Erro } from './meta.js';

const BASE = (process.env.KOMMO_BASE_URL || 'https://gruposinop.kommo.com').replace(/["'\s]/g, '').replace(/\/$/, '');
const CONTA_ID = Number(process.env.KOMMO_ACCOUNT_ID || 33567279);
const FUNIL = process.env.KOMMO_PIPELINE_ID || '9691959';
const EMPREENDIMENTO = (process.env.KOMMO_EMPREENDIMENTO || 'savia').toLowerCase();
const OFFSET = process.env.DASH_UTC_OFFSET || '-03:00';
const FUSO = process.env.DASH_FUSO || 'America/Recife';

let contaOk = null;
async function api(caminho, params) {
  const token = (process.env.KOMMO_TOKEN || '').replace(/^\s*KOMMO_TOKEN\s*=/, '').replace(/[\s"']/g, '');
  if (!token) throw new Erro(500, 'KOMMO_TOKEN não configurado no servidor.');
  const r = await fetch(`${BASE}${caminho}?` + new URLSearchParams(params || {}), { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 204) return null;
  if (r.status === 401) throw new Erro(502, 'Kommo recusou o token.');
  if (r.status === 429) throw new Erro(429, 'Kommo limitou as consultas. Tente de novo em instantes.');
  if (!r.ok) throw new Erro(502, `Kommo respondeu ${r.status}.`);
  return r.json();
}

const diaDe = (epoch) => new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date(epoch * 1000));

export async function leadsKommo(per) {
  // Trava de conta: o token tem que ser o do Grupo Sinop.
  if (!contaOk) contaOk = api('/api/v4/account').then((a) => { if (!a || a.id !== CONTA_ID) throw new Erro(500, 'O token do Kommo aponta para outra conta.'); return true; });
  try { await contaOk; } catch (e) { contaOk = null; throw e; }

  const de = Math.floor(Date.parse(`${per.since}T00:00:00${OFFSET}`) / 1000);
  const ate = Math.floor(Date.parse(`${per.until}T23:59:59${OFFSET}`) / 1000);
  const linhas = new Map();
  let sem = 0, semQual = 0;
  for (let pag = 1; pag <= 60; pag++) {
    const j = await api('/api/v4/leads', { page: pag, limit: 250, 'filter[pipeline_id]': FUNIL, 'filter[created_at][from]': de, 'filter[created_at][to]': ate });
    const leads = (j && j._embedded && j._embedded.leads) || [];
    for (const l of leads) {
      if (String(l.pipeline_id) !== String(FUNIL)) continue;
      const c = {};
      for (const f of l.custom_fields_values || []) c[f.field_name] = f.values && f.values[0] ? String(f.values[0].value ?? '') : '';
      if (!(c['Empreendimento'] || '').toLowerCase().includes(EMPREENDIMENTO)) continue;
      if (!/meta/i.test(c['Fonte do Lead'] || '')) continue;
      const qual = l.status_id === 142 ? 1 : 0;
      const conjunto = (c['utm_term'] || '').replace(/^\d+_/, '').trim();
      const campanha = c['utm_campaign'] || '';
      if (!/SAV[_-]/i.test(campanha) || !/^CP\d+_CJ\d+_/i.test(conjunto)) { sem++; semQual += qual; continue; }
      const tipo = /FORM|CADASTRO/i.test(campanha) ? 'form' : 'whats';
      const dia = diaDe(l.created_at);
      const k = `${conjunto}|${tipo}|${dia}`;
      const a = linhas.get(k) || { conjunto, cidade: cidadeDoConjunto(conjunto), tipo, dia, leads: 0, qual: 0 };
      a.leads++; a.qual += qual;
      linhas.set(k, a);
    }
    if (!j || !j._links || !j._links.next) break;
  }
  return { ok: true, linhas: [...linhas.values()], sem, semQual };
}
