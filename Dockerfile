FROM node:20-alpine

# Install FFmpeg and essential build tools
RUN apk add --no-cache ffmpeg \
    && apk add --no-cache --virtual .build-deps python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev \
    && npm install --no-save better-sqlite3 ws \
    && apk del .build-deps

COPY . .

RUN mkdir -p /app/sessions && chown -R node:node /app/sessions

# Run as non-root user
USER node

EXPOSE 3002

ENV NODE_ENV=production
ENV PORT=3002

CMD ["node", "src/index.js"]
