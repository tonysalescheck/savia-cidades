// Coleta e normaliza os dados da Meta Marketing API para o dashboard por cidade.
// Estrutura OUT.CV.B3 (desde 07/10/2026): CP07 topo (TOF), CP08 meio (MOF), CP09 fundo (BOF).
const VERSAO = process.env.META_API_VERSION || 'v23.0';
const CONTA = process.env.META_AD_ACCOUNT || 'act_575268475006319';
const CAMPANHAS = (process.env.META_CAMPAIGN_IDS || '120253446034750526,120253446035890526,120253446036770526').split(',').map((s) => s.trim());
const INICIO = process.env.DASH_INICIO || '2026-10-07';
const FUSO = process.env.DASH_FUSO || 'America/Recife'; // fuso da conta de anúncios
const TTL_MS = Number(process.env.DASH_TTL_MIN || 30) * 60 * 1000;

export const AMPLO = 'Sinop + região';

// Etapa do funil: topo e meio otimizam visita à LP, fundo otimiza lead de formulário.
export const ETAPAS = {
  tof: { nome: 'Topo', resultado: 'Visitas à LP', acao: 'landing_page_view' },
  mof: { nome: 'Meio', resultado: 'Visitas à LP', acao: 'landing_page_view' },
  bof: { nome: 'Fundo', resultado: 'Leads de formulário', acao: 'lead' },
};

const NOMES = {
  COLIDER: 'Colíder', GUARANTA_DO_NORTE: 'Guarantã do Norte', JUARA: 'Juara', MARCELANDIA: 'Marcelândia',
  MATUPA: 'Matupá', NOVA_CANAA_DO_NORTE: 'Nova Canaã do Norte', PEIXOTO_DE_AZEVEDO: 'Peixoto de Azevedo',
  ALTA_FLORESTA: 'Alta Floresta', NOVO_PROGRESSO_PA: 'Novo Progresso (PA)', CASTELO_DOS_SONHOS_PA: 'Castelo dos Sonhos (PA)',
  SINOP: 'Sinop',
};

// Etapa pelo nome da campanha (_TOF_/_MOF_/_BOF_), do conjunto ou do anúncio (TOPO_/MEIO_/FUNDO_);
// se nada bater, pelo objetivo da campanha.
export function etapaDe(nome, objetivo) {
  const n = String(nome || '').toUpperCase();
  if (/(^|[_\s-])TOF([_\s-]|$)|^TOPO[_-]/.test(n)) return 'tof';
  if (/(^|[_\s-])MOF([_\s-]|$)|^MEIO[_-]/.test(n)) return 'mof';
  if (/(^|[_\s-])BOF([_\s-]|$)|^FUNDO[_-]|CADASTRO|FORMS?([_\s-]|$)/.test(n)) return 'bof';
  return objetivo === 'OUTCOME_LEADS' ? 'bof' : 'tof';
}

// A cidade vem do nome do conjunto (CP09_CJ05_ABERTO_JUARA_H.M_30.55_FB.IG). Conjunto com
// "REGIÕES" é o amplo (várias cidades) e fica como referência, fora dos totais.
// Prefixos de segmento (ABERTO, MORNO, REMARKETING, INTERESSES_LUXO) saem antes de ler a cidade.
export function cidadeDoConjunto(nome) {
  if (/REGI[ÕO]ES/i.test(nome)) return AMPLO;
  const m = nome.replace(/\s+/g, '').match(/CP\d+_CJ\d+_(.+?)_H\.M/i);
  if (!m) return nome;
  const k = m[1].toUpperCase().replace(/^(?:ABERTO_|MORNO_|REMARKETING_|INTERESSES_LUXO_|LUXO_)+/, '');
  return NOMES[k] || k.toLowerCase().replace(/_/g, ' ').replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

export function segmentoDoConjunto(nome) {
  const n = String(nome).toUpperCase();
  if (/REMARKETING/.test(n)) return 'Remarketing';
  if (/LUXO/.test(n)) return 'Luxo';
  return 'Aberto';
}

// Nome do anúncio: TOPO_OUT.CV.B3_AD02-IMG-C1 → código AD02, formato IMG, copy C1.
export function lerAnuncio(nome) {
  const m = String(nome).match(/(AD\d+)[-_]?(IMG|VDO|VID|CAR)?(?:[-_]?(C\d+))?/i);
  return {
    codigo: m ? m[1].toUpperCase() : nome,
    formato: m && m[2] ? (/^V/i.test(m[2]) ? 'Vídeo' : m[2].toUpperCase() === 'CAR' ? 'Carrossel' : 'Imagem') : 'Imagem',
    copy: m && m[3] ? m[3].toUpperCase() : '',
  };
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
  // Tolera colagem com aspas, espaços, quebra de linha ou o prefixo "META_ADS_TOKEN=".
  const token = (process.env.META_ADS_TOKEN || '').replace(/^\s*META_ADS_TOKEN\s*=/, '').replace(/[\s"']/g, '');
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
    if (Array.isArray(j.data)) linhas.push(...j.data); else return j;
    url = j.paging && j.paging.next;
  }
  return linhas;
}

const acao = (r, t, campo = 'actions') => Number(((r[campo] || []).find((a) => a.action_type === t) || {}).value || 0);

// Ficha dos criativos (imagem, título, texto) por nome de anúncio. Muda pouco: cache próprio de 6 h.
// As URLs de imagem são assinadas pela Meta e valem alguns dias; renovam a cada coleta.
let fichaCache = { t: 0, p: null };
async function fichas(filtro) {
  if (fichaCache.p && Date.now() - fichaCache.t < 6 * 3600 * 1000) return fichaCache.p;
  const p = (async () => {
    const ads = await graph(`${CONTA}/ads`, {
      fields: 'id,name,adset_id,effective_status,creative{object_story_spec,asset_feed_spec,thumbnail_url}',
      filtering: filtro, limit: 500,
    });
    const hashes = new Set(), videos = new Set();
    const porNome = new Map();
    for (const a of ads) {
      const c = a.creative || {}, afs = c.asset_feed_spec || {}, oss = c.object_story_spec || {};
      const vd = oss.video_data || {}, ld = oss.link_data || {};
      const imgs = afs.images || [];
      // Imagem 1:1 (rótulo "feed") de preferência; senão a primeira; senão a do link_data.
      const feed = imgs.find((i) => (i.adlabels || []).some((l) => /feed/i.test(l.name))) || imgs[0];
      const hash = (feed && feed.hash) || ld.image_hash || '';
      const video = (afs.videos && afs.videos[0] && afs.videos[0].video_id) || vd.video_id || '';
      if (hash) hashes.add(hash);
      if (video) videos.add(video);
      const f = porNome.get(a.name) || {
        nome: a.name, etapa: etapaDe(a.name), ...lerAnuncio(a.name), hash, video,
        titulo: (afs.titles && afs.titles[0] && afs.titles[0].text) || vd.title || ld.name || '',
        texto: (afs.bodies && afs.bodies[0] && afs.bodies[0].text) || vd.message || ld.message || '',
        miniatura: c.thumbnail_url || '', ads: 0, ativos: 0,
      };
      f.ads++; if (a.effective_status === 'ACTIVE') f.ativos++;
      porNome.set(a.name, f);
    }
    const imagens = new Map();
    if (hashes.size) {
      const lista = await graph(`${CONTA}/adimages`, { hashes: JSON.stringify([...hashes]), fields: 'hash,url,url_128', limit: 200 });
      for (const i of lista) imagens.set(i.hash, { img: i.url, thumb: i.url_128 || i.url });
    }
    const capas = new Map();
    await Promise.all([...videos].map(async (v) => {
      try {
        const j = await graph(v, { fields: 'picture,thumbnails{uri,is_preferred}' });
        const t = ((j.thumbnails || {}).data || []);
        const pref = t.find((x) => x.is_preferred) || t[0];
        capas.set(v, { img: (pref && pref.uri) || j.picture || '', thumb: j.picture || (pref && pref.uri) || '' });
      } catch (e) { /* sem capa: o front mostra o nome */ }
    }));
    const out = {};
    for (const [n, f] of porNome) {
      const im = (f.hash && imagens.get(f.hash)) || (f.video && capas.get(f.video)) || { img: '', thumb: f.miniatura };
      const { hash, video, miniatura, ...resto } = f;
      out[n] = { ...resto, img: im.img, thumb: im.thumb };
    }
    return out;
  })();
  fichaCache = { t: Date.now(), p };
  p.catch(() => { fichaCache = { t: 0, p: null }; });
  return p;
}

async function coletar(per) {
  const filtro = JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: CAMPANHAS }]);
  const tr = JSON.stringify({ since: per.since, until: per.until });
  const campos = 'campaign_id,adset_id,adset_name,spend,impressions,reach,frequency,inline_link_clicks,actions';
  const ins = (extra) => graph(`${CONTA}/insights`, { fields: campos, time_range: tr, filtering: filtro, limit: 500, ...extra });

  // O Kommo é complementar: se falhar, o dashboard segue só com a Meta e avisa.
  const { leadsKommo } = await import('./kommo.js');
  const campsP = graph(`${CONTA}/campaigns`, { fields: 'id,name,objective,effective_status,daily_budget', filtering: JSON.stringify([{ field: 'id', operator: 'IN', value: CAMPANHAS }]), limit: 50 });
  const kommoP = campsP.then((cs) => leadsKommo(per, cs.map((c) => c.name))).catch((e) => ({ ok: false, erro: e instanceof Erro ? e.message : 'Falha ao consultar o Kommo.', linhas: [], sem: 0, semQual: 0 }));
  const fichasP = fichas(filtro).catch(() => ({}));

  const [camps, sets, agg, dia, ads] = await Promise.all([
    campsP,
    graph(`${CONTA}/adsets`, { fields: 'id,name,campaign_id,effective_status,optimization_goal', filtering: filtro, limit: 300 }),
    ins({ level: 'adset' }),
    ins({ level: 'adset', time_increment: 1 }),
    ins({ level: 'ad', fields: campos + ',ad_id,ad_name,video_thruplay_watched_actions' }),
  ]);

  const campanhas = camps.map((c) => ({ id: c.id, nome: c.name, etapa: etapaDe(c.name, c.objective), status: c.effective_status, verba_dia: Number(c.daily_budget || 0) / 100 }));
  const etapaCamp = new Map(campanhas.map((c) => [c.id, c.etapa]));
  const meta = new Map(sets.map((s) => [s.id, {
    nome: s.name, cidade: cidadeDoConjunto(s.name), segmento: segmentoDoConjunto(s.name), status: s.effective_status,
    etapa: etapaCamp.get(s.campaign_id) || etapaDe(s.name, s.optimization_goal === 'LEAD_GENERATION' || s.optimization_goal === 'QUALITY_LEAD' ? 'OUTCOME_LEADS' : ''),
  }]));
  const linha = (r) => {
    const m = meta.get(r.adset_id) || { nome: r.adset_name, cidade: cidadeDoConjunto(r.adset_name), segmento: segmentoDoConjunto(r.adset_name), status: 'DESCONHECIDO', etapa: etapaCamp.get(r.campaign_id) || etapaDe(r.adset_name) };
    return {
      adset_id: r.adset_id, conjunto: m.nome, cidade: m.cidade, segmento: m.segmento, etapa: m.etapa, status: m.status,
      inv: Number(r.spend || 0), imp: Number(r.impressions || 0), cli: Number(r.inline_link_clicks || 0),
      alc: Number(r.reach || 0), freq: Number(r.frequency || 0),
      // Resultado da etapa: visita à LP (topo/meio) ou lead de formulário (fundo). Os dois ficam na linha.
      lpv: acao(r, 'landing_page_view'), leads: acao(r, 'lead'),
    };
  };

  const conjuntos = agg.map(linha);
  // Conjunto ativo sem entrega no período aparece zerado, para a cidade não sumir da lista.
  const comDado = new Set(conjuntos.map((c) => c.adset_id));
  for (const [id, m] of meta) {
    if (m.status === 'ACTIVE' && !comDado.has(id)) {
      conjuntos.push({ adset_id: id, conjunto: m.nome, cidade: m.cidade, segmento: m.segmento, etapa: m.etapa, status: m.status, inv: 0, imp: 0, cli: 0, alc: 0, freq: 0, lpv: 0, leads: 0 });
    }
  }

  const dias = [];
  for (let d = per.since; d <= per.until; d = somaDias(d, 1)) dias.push(d);

  return {
    atualizado: new Date().toISOString(),
    ttl_min: TTL_MS / 60000,
    periodo: per, inicio: INICIO, hoje: hoje(), dias, amplo: AMPLO, etapas: ETAPAS,
    campanhas, conjuntos,
    kommo: await kommoP,
    criativos: await fichasP,
    diario: dia.map((r) => ({ ...linha(r), dia: r.date_start })).map(({ alc, freq, status, conjunto, segmento, ...r }) => r),
    anuncios: ads.map((r) => ({ ...linha(r), ad_id: r.ad_id, anuncio: r.ad_name, thru: acao(r, 'video_view', 'video_thruplay_watched_actions') })).map(({ alc, freq, status, ...r }) => r),
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
