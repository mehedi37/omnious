# ─── Build stage ──────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps first (cache layer)
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
RUN npm ci --workspace=@omnious/backend --include-workspace-root

# Copy source and build
COPY backend/tsconfig.json ./backend/
COPY backend/src/ ./backend/src/
RUN npm run build --workspace=@omnious/backend

# ─── Production stage ────────────────────────────────────────────
FROM node:22-alpine AS runner

RUN apk add --no-cache tini && \
    addgroup -g 1001 -S omnious && \
    adduser -S omnious -u 1001

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
RUN npm ci --workspace=@omnious/backend --include-workspace-root --omit=dev

COPY --from=builder /app/backend/dist ./backend/dist

# Non-root user
USER omnious

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

# Use tini for proper PID 1 signal handling
ENTRYPOINT ["tini", "--"]
CMD ["node", "backend/dist/server.js"]
