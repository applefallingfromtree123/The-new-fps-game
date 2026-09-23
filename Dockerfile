# Matchmaking server for the online modes.
# The static client can live anywhere (GitHub Pages); this image only needs to
# serve the WebSocket endpoint, but it ships the whole game so it works alone.
FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.js"]
