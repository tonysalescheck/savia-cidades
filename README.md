# Savia · desempenho por cidade

Dashboard ao vivo das campanhas da Savia com conjuntos por cidade (Meta Ads), estrutura OUT.CV.B3:
CP07 topo (tráfego para a LP), CP08 meio (remarketing morno para a LP) e CP09 fundo (formulário nativo).
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

- `lib/meta.js` consulta campanhas, conjuntos e insights das campanhas em `META_CAMPAIGN_IDS`, descobre a cidade
  pelo nome do conjunto (`CP09_CJ05_ABERTO_JUARA_H.M_...`, ignorando os prefixos ABERTO/MORNO/REMARKETING/LUXO)
  e guarda a resposta em memória por 30 min.
- Etapa pelo nome da campanha (`_TOF_`, `_MOF_`, `_BOF_`) ou do anúncio (`TOPO_`, `MEIO_`, `FUNDO_`).
  Resultado = visita à LP (`landing_page_view`) no topo e meio, lead de formulário (`lead`) no fundo.
- Conjunto novo numa dessas campanhas aparece sozinho. Cidade com nome novo sai sem acento até entrar em `NOMES`.
- Conjuntos com `REGIÕES` no nome são os amplos: aparecem como referência, fora dos totais.
- Criativos: a ficha (arte, título, formato, copy) vem dos anúncios e do `adimages`, com cache próprio de 6 h.
  As URLs de imagem são assinadas pela Meta e valem alguns dias; renovam a cada coleta. O mesmo criativo é
  somado em todas as cidades e ranqueado por menor custo por resultado da etapa (sem resultado, maior CTR).
- Sem `DASH_SENHA`, a CDN do Vercel também guarda a resposta por 30 min. Com senha, o cache é só o da
  função, que zera quando ela hiberna; a primeira abertura depois disso consulta a Meta de novo.

## Kommo

Com `KOMMO_TOKEN` configurado, `lib/kommo.js` soma leads e qualificados do Kommo por cidade (somente leitura,
só números agregados). Regra: card criado no funil de qualificação, Fonte do Lead = Meta Ads, Empreendimento =
Savia, campanha entre as do dashboard; qualificado = status 142 nesse funil. A cidade vem do `utm_term`, que
traz o nome do conjunto, e a etapa do `utm_campaign`.
Sem o token, ou se o Kommo falhar, o dashboard segue só com a Meta e mostra o aviso no lugar dos números.
