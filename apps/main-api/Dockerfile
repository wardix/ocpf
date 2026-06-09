# Stage 1: Build & Prepare
FROM oven/bun:1-alpine as build
WORKDIR /app

# Copy workspace setup
COPY package.json bun.lock ./
COPY packages/shared-types packages/shared-types
COPY apps/widget apps/widget
COPY apps/main-api apps/main-api

# Install dependencies
RUN bun install --frozen-lockfile

# Build widget and copy to main-api public directory
WORKDIR /app/apps/widget
RUN bun run build && cp dist/widget.js /app/apps/main-api/public/widget.js

# Stage 2: Production Runner
FROM oven/bun:1-alpine
WORKDIR /app

# Copy build workspace
COPY --from=build /app /app

EXPOSE 8000
WORKDIR /app/apps/main-api

CMD ["bun", "run", "src/index.ts"]
