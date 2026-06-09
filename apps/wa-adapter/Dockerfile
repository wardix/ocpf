FROM node:20-slim
WORKDIR /app

# Install Bun for monorepo workspace dependencies management
RUN apt-get update && apt-get install -y curl unzip && \
    curl -fsSL https://bun.sh/install | bash && \
    ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Copy workspace setup
COPY package.json bun.lock ./
COPY packages/shared-types packages/shared-types
COPY apps/wa-adapter apps/wa-adapter

# Install dependencies
RUN bun install --frozen-lockfile

WORKDIR /app/apps/wa-adapter

# Start the adapter in Node.js runtime using tsx
CMD ["npx", "tsx", "src/index.ts"]
