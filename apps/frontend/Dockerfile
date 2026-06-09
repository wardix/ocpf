# Stage 1: Build React App
FROM oven/bun:1-alpine as build
WORKDIR /app

# Copy workspace setup
COPY package.json bun.lock ./
COPY packages/shared-types packages/shared-types
COPY apps/frontend apps/frontend

# Install dependencies
RUN bun install --frozen-lockfile

# Pass build args to environment variables for Vite
ARG VITE_API_URL
ARG VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

# Build frontend
WORKDIR /app/apps/frontend
RUN bun run build

# Stage 2: Serve using Nginx
FROM nginx:alpine
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html

# Configure Nginx for single page application (SPA) routing
RUN echo 'server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html index.htm; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
