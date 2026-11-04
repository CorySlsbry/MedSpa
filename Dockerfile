# Aesthera · MedSpa Management Software — Cloud Run image
# Multi-stage Next.js standalone build. Final image is ~150 MB.

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# ── builder ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# googleapis pulls in a ~3 MB type definition tree that pushes Next's type
# checker over the 2 GB Node default. Bump heap to 6 GB so the build doesn't
# OOM-kill during `next build` → "Linting and checking validity of types".
ENV NODE_OPTIONS=--max-old-space-size=6144
RUN npm run build

# ── runner ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# Cloud Run sends SIGTERM and expects the process to honor PORT
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

# Next standalone output bundles only the runtime files we need
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 8080

CMD ["node", "server.js"]
