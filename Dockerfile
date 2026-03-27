FROM node:20-slim

# Instalar dependências do Chrome
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-noto \
    fonts-noto-color-emoji \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar package.json e instalar dependências
COPY package.json .
RUN npm install

# Copiar o servidor
COPY server.js .

# Puppeteer usa o Chromium do sistema, não baixa o próprio
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 3000

CMD ["node", "server.js"]
