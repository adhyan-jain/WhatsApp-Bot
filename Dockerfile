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
    xdg-utils \
    wget \
    ca-certificates \
    dumb-init \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Environment variables for Puppeteer and production mode
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production \
    DOCKER=true \
    NODE_OPTIONS="--max-old-space-size=512"

# Create app user for better security
RUN groupadd -r appuser && useradd -r -g appuser -G audio,video appuser

# Create and set working directory
WORKDIR /app

# Copy dependency files first to leverage Docker caching
COPY package*.json ./

# Install production dependencies (ci is faster & safer for CI/CD)
RUN npm ci --omit=dev && npm cache clean --force

# Copy the rest of the application files
COPY . .

# Ensure writable directories for session data and caching
RUN mkdir -p /app/data /app/.wwebjs_auth && \
    chown -R appuser:appuser /app && \
    chmod -R 755 /app/data /app/.wwebjs_auth

# Switch to non-root user
USER appuser

# Expose the app port (Render auto-assigns but 3000 is standard)
EXPOSE 3000

# Add a reliable healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health',(r)=>{let d='';r.on('data',(c)=>d+=c);r.on('end',()=>{try{const j=JSON.parse(d);process.exit(j.status==='running'?0:1)}catch(e){process.exit(1)}})}).on('error',()=>process.exit(1))"

# Use dumb-init to handle signals properly
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Run the application with proper error handling
CMD ["node", "--unhandled-rejections=strict", "main.js"]