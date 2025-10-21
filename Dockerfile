# Use latest stable Node LTS (22) for security and performance
FROM node:22-bullseye-slim

# Install Chromium and all required dependencies for Puppeteer
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
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libgtk-3-0 \
    wget \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Environment variables for Puppeteer and production mode
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    DOCKER=true

# Create and set working directory
WORKDIR /app

# Copy dependency files first to leverage Docker caching
COPY package*.json ./

# Install production dependencies (ci is faster & safer for CI/CD)
RUN npm ci --omit=dev

# Copy the rest of the application files
COPY . .

# Ensure writable directories for session data and caching
RUN mkdir -p /app/data /app/.wwebjs_auth && \
    chmod -R 777 /app/data /app/.wwebjs_auth

# Expose the app port (Render auto-assigns but 3000 is standard)
EXPOSE 3000

# Add a reliable healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "try{require('http').get('http://localhost:3000/health',r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{if(!d||!d.includes('running'))process.exit(1)})}).on('error',()=>process.exit(1));}catch(e){process.exit(1);}"

# Run the application
CMD ["node", "main.js"]