# Rastro API — imagem de produção.
#
# Multi-stage porque o build precisa de TypeScript e o runtime não. A imagem
# final leva apenas `dist` e as dependências de produção.
#
# Só `core` e `api` são instalados. O workspace `app` (Expo, React Native) fica
# de fora de propósito: são centenas de MB que o servidor nunca executa.

# ---------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Os package.json antes do código: enquanto as dependências não mudam, o Docker
# reaproveita a camada de install e o build leva segundos em vez de minutos.
# O de `app` entra porque o npm valida o lockfile contra todos os workspaces
# declarados na raiz — sem ele, `npm ci` recusa a árvore.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/api/package.json  packages/api/
COPY packages/app/package.json  packages/app/

RUN npm ci --include-workspace-root \
      --workspace @rastro/core \
      --workspace @rastro/api

COPY packages/core packages/core
COPY packages/api  packages/api

RUN npm run build --workspace @rastro/core \
 && npm run build --workspace @rastro/api

# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/api/package.json  packages/api/
COPY packages/app/package.json  packages/app/

RUN npm ci --omit=dev --include-workspace-root \
      --workspace @rastro/core \
      --workspace @rastro/api \
 && npm cache clean --force

COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/api/dist  packages/api/dist

# `node` já existe na imagem oficial e não é root. Um processo que só lê o
# próprio dist não tem motivo para ter permissão de escrever nele.
USER node

EXPOSE 4891

# O healthcheck é o que faz o Dokploy trocar a versão só depois que a nova
# responde. Sem ele, um deploy quebrado derruba o serviço em vez de ser barrado.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4891)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `start` roda as migrations antes de subir o servidor. É seguro em paralelo:
# o migrate pega um advisory lock, então o segundo container espera em vez de
# aplicar o mesmo DDL duas vezes.
CMD ["npm", "run", "start", "--workspace", "@rastro/api"]
