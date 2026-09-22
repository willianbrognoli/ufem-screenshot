# ufem-screenshot

Microserviço em **Node.js (Express + Puppeteer)** que renderiza HTML em imagem PNG e em PDF. Usado como etapa de renderização em workflows n8n de produção de conteúdo: a IA gera o HTML de cada card (carrossel, post único, story), o serviço tira a screenshot em alta resolução e envia direto ao Cloudinary, devolvendo as URLs públicas para publicação no Instagram, Facebook e blog.

Mantém uma única instância do Chromium aberta e reaproveitada entre chamadas, o que torna o render de um carrossel de 10 slides questão de segundos.

## Endpoints

| Método | Rota | Corpo | Resposta |
|---|---|---|---|
| `GET` | `/health` | — | `{"status":"ok","browser":"connected"}` |
| `POST` | `/screenshot` | `{"html","width":1080,"height":1080}` | PNG binário (2x, retina) |
| `POST` | `/screenshots-and-upload` | `{"renders":[{"num","html","w","h","tipo"}],"cloudinary":{"cloud_name","upload_preset"}}` | `{"imageUrls":[...],"storyUrl":"..."}` |
| `POST` | `/html-to-pdf` | `{"html","format":"A4","margin":{...}}` | `{"pdf_base64":"..."}` |

Em `/screenshots-and-upload`, itens com `tipo: "story"` vão para `storyUrl`; os demais entram em ordem em `imageUrls`. O upload usa **unsigned upload preset** do Cloudinary, sem chave secreta no serviço.

## Como funciona

1. Abre uma página no Chromium com o viewport pedido e `deviceScaleFactor: 2`.
2. Injeta o HTML, espera `networkidle0` e `document.fonts.ready` (mais 600 ms de folga para web fonts).
3. Captura a área exata (`clip`) e fecha a página; o browser fica vivo para a próxima chamada.

## Rodando

```bash
docker build -t ufem-screenshot .
docker run -p 3000:3000 ufem-screenshot
curl -X POST localhost:3000/screenshot -H "Content-Type: application/json" \
  -d '{"html":"<h1 style=\"font:bold 80px sans-serif\">Olá</h1>"}' -o teste.png
```

No Easypanel: App > Dockerfile, porta interna 3000, sem domínio público (o n8n acessa por `http://<projeto>_ufem-screenshot:3000`).

## Variáveis de ambiente

| Variável | Padrão |
|---|---|
| `PORT` | `3000` |
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium` |

## Stack

Node 20 · Express · puppeteer-core · Chromium · Cloudinary Upload API · Docker
