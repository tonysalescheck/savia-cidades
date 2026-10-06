// Coleta e normaliza os dados da Meta Marketing API para o dashboard por cidade.
const VERSAO = process.env.META_API_VERSION || 'v23.0';
const CONTA = process.env.META_AD_ACCOUNT || 'act_575268475006319';
const CAMPANHAS = (process.env.META_CAMPAIGN_IDS || '120244361902950526,120252576314370526').split(',').map((s) => s.trim());
const INICIO = process.env.DASH_INICIO || '2026-10-02';
const FUSO = process.env.DASH_FUSO || 'America/Recife'; // fuso da conta de anúncios
const TTL_MS = Number(process.env.DASH_TTL_MIN || 30) * 60 * 1000;

const ACAO_FORM = 'lead';
const ACAO_WHATS = 'onsite_conversion.messaging_conversation_started_7d';
export const AMPLO = 'Sinop + região';

const NOMES = {
  COLIDER: 'Colíder', GUARANTA_DO_NORTE: 'Guarantã do Norte', JUARA: 'Juara', MARCELANDIA: 'Marcelândia',
  MATUPA: 'Matupá', NOVA_CANAA_DO_NORTE: 'Nova Canaã do Norte', PEIXOTO_DE_AZEVEDO: 'Peixoto de Azevedo',
  ALTA_FLORESTA: 'Alta Floresta', NOVO_PROGRESSO_PA: 'Novo Progresso (PA)', CASTELO_DOS_SONHOS_PA: 'Castelo dos Sonhos (PA)',
  SINOP: 'Sinop',
};

// A cidade vem do nome do conjunto (CP01_CJ12_ABERTO_JUARA_H.M_...). Conjunto com
// "+REGIÕES" é o amplo (várias cidades) e fica como referência, fora dos totais.
export function cidadeDoConjunto(nome) {
  if (/REGI[ÕO]ES/i.test(nome)) return AMPLO;
  const m = nome.replace(/\s+/g, '').match(/CP\d+_CJ\d+_(?:ABERTO_)?(.+?)_H\.M/i);
  if (!m) return nome;
  const k = m[1].toUpperCase();
  return NOMES[k] || k.toLowerCase().replace(/_/g, ' ').replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

const iso = (d) => d.toISOString().slice(0, 10);
const hoje = () => new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date());
const somaDias = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

export function resolverPeriodo(q) {
  const h = hoje();
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (q.since || q.until) {
    if (!re.test(q.since || '') || !re.test(q.until || '') || q.since > q.until) throw new Erro(400, 'Período inválido.');
    if (q.until > h) q.until = h;
    if (q.since > q.until) throw new Erro(400, 'Período inválido.');
    if (somaDias(q.since, 92) < q.until) throw new Erro(400, 'Período máximo de 92 dias.');
    return { chave: 'custom', since: q.since, until: q.until };
  }
  const p = q.periodo || 'inicio';
  if (p === 'hoje') return { chave: p, since: h, until: h };
  if (p === 'ontem') return { chave: p, since: somaDias(h, -1), until: somaDias(h, -1) };
  if (p === '7d') return { chave: p, since: somaDias(h, -6), until: h };
  if (p === '30d') return { chave: p, since: somaDias(h, -29), until: h };
  if (p === 'inicio') return { chave: p, since: INICIO, until: h };
  throw new Erro(400, 'Período inválido.');
}

export class Erro extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function graph(caminho, params) {
  const token = process.env.META_ADS_TOKEN;
  if (!token) throw new Erro(500, 'META_ADS_TOKEN não configurado no servidor.');
  let url = `https://graph.facebook.com/${VERSAO}/${caminho}?` + new URLSearchParams({ ...params, access_token: token });
  const linhas = [];
  for (let pag = 0; url && pag < 20; pag++) {
    const r = await fetch(url);
    const j = await r.json();
    if (j.error) {
      const limite = [4, 17, 32, 613, 80000, 80004].includes(j.error.code);
      throw new Erro(limite ? 429 : 502, limite ? 'A Meta limitou as consultas desta conta. Tente de novo em alguns minutos.' : `Meta API: ${j.error.message}`);
    }
    linhas.push(...(j.data || []));
    url = j.paging && j.paging.next;
  }
  return linhas;
}

const acao = (r, t) => Number(((r.actions || []).find((a) => a.action_type === t) || {}).value || 0);

async function coletar(per) {
  const filtro = JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: CAMPANHAS }]);
  const tr = JSON.stringify({ since: per.since, until: per.until });
  const campos = 'campaign_id,adset_id,adset_name,spend,impressions,reach,frequency,inline_link_clicks,actions';
  const ins = (extra) => graph(`${CONTA}/insights`, { fields: campos, time_range: tr, filtering: filtro, limit: 500, ...extra });

  const [sets, agg, dia, ads] = await Promise.all([
    graph(`${CONTA}/adsets`, { fields: 'id,name,campaign_id,effective_status,optimization_goal', filtering: filtro, limit: 300 }),
    ins({ level: 'adset' }),
    ins({ level: 'adset', time_increment: 1 }),
    ins({ level: 'ad', fields: campos + ',ad_id,ad_name' }),
  ]);

  const meta = new Map(sets.map((s) => [s.id, {
    nome: s.name, cidade: cidadeDoConjunto(s.name), status: s.effective_status,
    tipo: s.optimization_goal === 'LEAD_GENERATION' || s.optimization_goal === 'QUALITY_LEAD' ? 'form' : 'whats',
  }]));
  const linha = (r) => {
    const m = meta.get(r.adset_id) || { nome: r.adset_name, cidade: cidadeDoConjunto(r.adset_name), status: 'DESCONHECIDO', tipo: 'whats' };
    return {
      adset_id: r.adset_id, conjunto: m.nome, cidade: m.cidade, tipo: m.tipo, status: m.status,
      inv: Number(r.spend || 0), imp: Number(r.impressions || 0), cli: Number(r.inline_link_clicks || 0),
      alc: Number(r.reach || 0), freq: Number(r.frequency || 0),
      leads: m.tipo === 'form' ? acao(r, ACAO_FORM) : 0,
      conv: m.tipo === 'whats' ? acao(r, ACAO_WHATS) : 0,
    };
  };

  const conjuntos = agg.map(linha);
  // Conjunto ativo sem entrega no período aparece zerado, para a cidade não sumir da lista.
  const comDado = new Set(conjuntos.map((c) => c.adset_id));
  for (const [id, m] of meta) {
    if (m.status === 'ACTIVE' && !comDado.has(id)) {
      conjuntos.push({ adset_id: id, conjunto: m.nome, cidade: m.cidade, tipo: m.tipo, status: m.status, inv: 0, imp: 0, cli: 0, alc: 0, freq: 0, leads: 0, conv: 0 });
    }
  }

  const dias = [];
  for (let d = per.since; d <= per.until; d = somaDias(d, 1)) dias.push(d);

  return {
    atualizado: new Date().toISOString(),
    ttl_min: TTL_MS / 60000,
    periodo: per, inicio: INICIO, hoje: hoje(), dias, amplo: AMPLO,
    conjuntos,
    diario: dia.map((r) => ({ ...linha(r), dia: r.date_start })).map(({ alc, freq, status, conjunto, ...r }) => r),
    anuncios: ads.map((r) => ({ ...linha(r), ad_id: r.ad_id, anuncio: r.ad_name })).map(({ alc, freq, status, ...r }) => r),
  };
}

// Cache em memória: segura as consultas à Meta por TTL_MS e junta pedidos simultâneos.
const cache = new Map();
export async function dados(per) {
  const k = `${per.since}|${per.until}`;
  const c = cache.get(k);
  if (c && Date.now() - c.t < TTL_MS) return c.p;
  const p = coletar(per);
  cache.set(k, { t: Date.now(), p });
  p.catch(() => cache.delete(k));
  if (cache.size > 50) cache.delete(cache.keys().next().value);
  return p;
}
