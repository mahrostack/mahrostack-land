# ============================
# Stage 1: Build (Vite)
# ============================
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install dependencies first (cache-efficient)
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund

# Copy application source
COPY . .

ARG APP_VERSION=dev
ENV VITE_APP_VERSION=$APP_VERSION

# Build static assets
RUN npm run build


# ============================
# Stage 2: Runtime (Nginx)
# ============================
FROM nginxinc/nginx-unprivileged:alpine

# Make the build version available to the entrypoint at runtime
# (env vars do not cross build stages, so re-declare here)
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# Remove default Nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy SPA-safe Nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --chmod=755 docker-entrypoint.d/40-env-config.sh /docker-entrypoint.d/40-env-config.sh
COPY --from=builder --chown=nginx:nginx /app/dist /usr/share/nginx/html

# Unprivileged Nginx listens on 8080
EXPOSE 8080

# Drop back to unprivileged user
USER nginx

# Run Nginx in foreground
CMD ["nginx", "-g", "daemon off;"]