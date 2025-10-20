FROM node:18-bullseye-slim

# Install dependencies including Chromium
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    libxtst6 \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    DOCKER=true

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Create data directory for persistent storage
RUN mkdir -p /app/data /app/.wwebjs_auth && \
    chmod -R 777 /app/data /app/.wwebjs_auth

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {let d='';r.on('data',(c)=>d+=c);r.on('end',()=>process.exit(JSON.parse(d).status==='running'?0:1))}).on('error',()=>process.exit(1))"

# Start the application
CMD ["node", "main.js"]