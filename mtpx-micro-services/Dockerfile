# =============================================================================
# Multi-stage Dockerfile for Production
# Optimized for Bun runtime with bytecode compilation
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Builder
# Installs dependencies and compiles TypeScript to optimized JavaScript
# -----------------------------------------------------------------------------
FROM oven/bun:1.1-alpine AS builder

WORKDIR /app

# Copy package files first (better layer caching)
COPY package.json bun.lock* ./

# Install ALL dependencies (including devDependencies for build)
RUN bun install --frozen-lockfile || bun install

# Copy source code
COPY . .

# Build with bytecode for faster startup
# --target=bun: Optimizations for Bun runtime
# --minify: Reduce bundle size
# --bytecode: Pre-compile to JSC bytecode (eliminates parsing overhead)
# --sourcemap=linked: Keep debugging possible
RUN NODE_ENV=production bun build ./src/main.ts \
    --target=bun \
    --outdir=./dist \
    --minify \
    --bytecode \
    --sourcemap=linked

# -----------------------------------------------------------------------------
# Stage 2: Production Runner
# Minimal image with only runtime dependencies
# -----------------------------------------------------------------------------
FROM oven/bun:1.1-alpine AS runner

# Security: Run as non-root user
RUN addgroup -g 1001 -S multpex && \
    adduser -S multpex -u 1001 -G multpex

WORKDIR /app

# Copy built artifacts from builder
COPY --from=builder --chown=multpex:multpex /app/dist ./dist

# Copy only production dependencies
COPY --from=builder --chown=multpex:multpex /app/node_modules ./node_modules

# Copy package.json for metadata
COPY --from=builder --chown=multpex:multpex /app/package.json ./

# Environment variables
ENV NODE_ENV=production
ENV BUN_ENV=production

# Switch to non-root user
USER multpex

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Expose default port
EXPOSE 3000

# Run the compiled application
# Bun automatically uses .jsc bytecode if present alongside .js
CMD ["bun", "run", "./dist/main.js"]
