# Use Node.js 18 LTS as base image
FROM node:18-alpine

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Remove build dependencies to reduce image size
RUN apk del python3 make g++

# Copy application source
COPY src/ ./src/

# Create directory for database
RUN mkdir -p /app/data

# Expose port
EXPOSE 4000

# Set environment to production by default
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "src/server.js"]
