# ─── Stage 1: Build dependencies ─────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Install only production dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci --only=production --ignore-scripts && \
    # Clean npm cache to reduce image size
    npm cache clean --force

# ─── Stage 2: Production image ────────────────────────────────────────────────
FROM node:20-alpine AS production

# Install tini for proper signal handling (PID 1 issue in containers)
RUN apk add --no-cache tini curl

WORKDIR /app

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser  -S nodejs -u 1001 -G nodejs

# Copy production dependencies from deps stage
COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy application source
COPY --chown=nodejs:nodejs . .

# Create QR output directory with correct permissions
RUN mkdir -p public/qr && chown -R nodejs:nodejs public

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 5000

# Health check — uses /api/health which has 5s cache-control
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:5000/api/health || exit 1

# Use tini as init process for proper signal forwarding
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
