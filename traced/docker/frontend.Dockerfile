# docker/frontend.Dockerfile
FROM node:18

WORKDIR /app/frontend

# Copy package files
COPY traced/frontend/package*.json ./

# Install dependencies
RUN npm install

# Copy frontend source
COPY traced/frontend/ ./

# Build frontend
RUN npm run build

# Serve using a simple HTTP server
RUN npm install -g serve
CMD ["serve", "-s", "build", "-l", "3000"]