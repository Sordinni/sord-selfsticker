FROM node:20-alpine

# Install FFmpeg and essential build tools
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Run as non-root user
USER node

EXPOSE 3002

ENV NODE_ENV=production
ENV PORT=3002

CMD ["node", "src/index.js"]
