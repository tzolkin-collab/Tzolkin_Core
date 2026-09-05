FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --omit=dev --workspace apps/api
FROM node:22-alpine
ENV NODE_ENV=production
# Porta única de verdade: production.mjs escuta em PORT, o healthcheck consulta
# PORT e o proxy publica PORT. Um valor herdado do bootstrap local (3100) passa
# a mover as três coisas juntas, em vez de deixar a app viva numa porta que a
# verificação de saúde não conhece.
ENV PORT=3000
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps ./apps
COPY certs ./certs
USER node
# Documental: reflete o padrão. Sobrescrever PORT no painel muda a porta real,
# e o healthcheck acompanha porque lê a variável em tempo de execução.
EXPOSE 3000
# Esta linha está na FORMA SHELL (o CMD não é array JSON), então roda via
# `/bin/sh -c` e qualquer `$PORT` seria expandido em RUNTIME, no container — a
# substituição de variáveis que o Docker faz no build não alcança
# RUN/CMD/ENTRYPOINT/HEALTHCHECK CMD, só instruções como ENV/EXPOSE/COPY/WORKDIR.
# Na FORMA EXEC (`CMD ["node","-e","...$PORT..."]`) não haveria expansão nenhuma:
# o array é entregue direto ao execve, sem shell, e `$PORT` chegaria como texto
# literal — o healthcheck tentaria abrir uma porta chamada "$PORT" e falharia
# sempre. Mesmo na forma shell preferimos ler process.env dentro do node: um só
# nível de escape (sem `$` disputado entre sh e Docker) e o comando continua
# correto caso a linha um dia seja convertida para forma exec.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","apps/api/src/production.mjs"]
