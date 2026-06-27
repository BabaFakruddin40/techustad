# ── Stage 1: Install dependencies ──
FROM node:20-alpine AS deps
WORKDIR /app

# Copy package files
COPY src/package.json ./

# Simple npm install
RUN npm install

# ── Stage 2: Production image ──
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy node_modules from deps stage with proper ownership
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# Copy application code with proper ownership
COPY --chown=node:node src/ .

# Copy .env file with proper ownership
COPY --chown=node:node .env ./

# Create data directory and ensure it's writable by node user
RUN mkdir -p /app/data && chown -R node:node /app/data && chmod 755 /app/data

EXPOSE 3000

USER node

CMD ["node", "server.js"]
