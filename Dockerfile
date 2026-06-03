# ── Stage 1: Install dependencies ──
FROM node:20-alpine AS deps
WORKDIR /app
COPY src/package*.json ./
RUN npm install --omit=dev

# ── Stage 2: Production image ──
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY src/ .

EXPOSE 3000

USER node

CMD ["node", "server.js"]
