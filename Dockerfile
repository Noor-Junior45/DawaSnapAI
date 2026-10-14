FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy application source code
COPY . .

# Build Vite frontend and bundle production server
RUN npm run build

# Production runtime configuration
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Run server in production mode
CMD ["node", "dist/server.cjs"]
