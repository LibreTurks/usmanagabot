## Base Image
FROM oven/bun:alpine

## Set Working Directory
WORKDIR /app

## Copy Files
COPY . /app/

## Install Dependencies
RUN bun install

## Move Dummy Config
RUN mv config/bot-example.jsonc config/bot.jsonc && \
    mv config/database-example.jsonc config/database.jsonc

## Health Endpoint Port (matches BOT__HEALTH__PORT default)
EXPOSE 3000

## Container Health Check (uses the /health/live endpoint)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+(process.env.BOT__HEALTH__PORT||'3000')+'/health/live').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

## Enjoy
CMD ["bun", "run", "start"]