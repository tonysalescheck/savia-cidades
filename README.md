# Savia · desempenho por cidade

Dashboard ao vivo das campanhas da Savia com conjuntos por cidade (Meta Ads).
Os dados vêm da Meta Marketing API e são renovados a cada 30 minutos.

## Rodar local

```
cp .env.example .env   # preencher META_ADS_TOKEN
npm run dev            # http://localhost:3000
```

Sem dependências: só Node 18 ou maior.

## Publicar no Vercel

1. Subir este repositório (privado) no GitHub e importar no Vercel. Não precisa de configuração de build.
2. Em Settings » Environment Variables, criar `META_ADS_TOKEN` e, se quiser senha, `DASH_SENHA`.
3. `public/` vira o site e `api/dados.js` vira a função que consulta a Meta.

O token nunca vai para o navegador nem para o git (`.env` está no `.gitignore`).

## Como funciona

- `lib/meta.js` consulta conjuntos e insights das campanhas em `META_CAMPAIGN_IDS`, descobre a cidade pelo
  nome do conjunto (`CP01_CJ12_ABERTO_JUARA_H.M_...`) e guarda a resposta em memória por 30 min.
- Conjunto novo numa dessas campanhas aparece sozinho. Cidade com nome novo sai sem acento até entrar em `NOMES`.
- Conjuntos com `+REGIÕES` no nome são os amplos: aparecem como referência, fora dos totais.
- Resultado = lead de formulário (conjunto de LEAD_GENERATION) ou conversa iniciada no WhatsApp.
- Sem `DASH_SENHA`, a CDN do Vercel também guarda a resposta por 30 min. Com senha, o cache é só o da
  função, que zera quando ela hiberna; a primeira abertura depois disso consulta a Meta de novo.
