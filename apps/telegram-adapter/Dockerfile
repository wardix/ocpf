FROM oven/bun:1-alpine
WORKDIR /app

# Copy workspace setup
COPY package.json bun.lock ./
COPY packages/shared-types packages/shared-types
COPY apps/telegram-adapter apps/telegram-adapter

# Install dependencies
RUN bun install --frozen-lockfile

WORKDIR /app/apps/telegram-adapter

CMD ["bun", "run", "index.ts"]
