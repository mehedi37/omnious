# ─── Build stage ──────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps first (cache layer) — include shared package so workspace symlinks resolve
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY backend/package.json ./backend/
RUN npm ci --workspace=@omnious/shared --workspace=@omnious/backend --include-workspace-root

# Build @omnious/shared first (backend imports from it)
COPY packages/shared/tsconfig.json ./packages/shared/
COPY packages/shared/src/ ./packages/shared/src/
RUN npm run build --workspace=@omnious/shared

# Copy source and build backend
COPY backend/tsconfig.json ./backend/
COPY backend/src/ ./backend/src/
RUN npm run build --workspace=@omnious/backend

# ─── Production stage ────────────────────────────────────────────
# Use Debian slim (glibc) — Alpine (musl) has no onnxruntime wheels, which
# chromadb (a mempalace dependency) requires.
FROM node:22-slim AS runner

RUN apt-get update && \
    apt-get install -y --no-install-recommends tini python3 python3-pip && \
    rm -rf /var/lib/apt/lists/* && \
    pip3 install --no-cache-dir mempalace --break-system-packages && \
    groupadd -g 1001 omnious && \
    useradd -r -u 1001 -g omnious omnious

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY backend/package.json ./backend/
RUN npm ci --workspace=@omnious/shared --workspace=@omnious/backend --include-workspace-root --omit=dev

# Copy compiled output for both packages
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/backend/dist ./backend/dist

# Non-root user
USER omnious

ENV NODE_ENV=production
ENV PORT=4000
ENV MEMPALACE_DATA_DIR=/data/palaces
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

# Use tini for proper PID 1 signal handling
ENTRYPOINT ["tini", "--"]
CMD ["node", "backend/dist/server.js"]
