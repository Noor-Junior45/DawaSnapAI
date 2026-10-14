FROM node:22-slim

WORKDIR /app

# Install dependencies (satisfies Node >= 22 engine requirement for firebase-admin and supabase)
COPY package.json package-lock.json ./
RUN npm ci || npm install

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
