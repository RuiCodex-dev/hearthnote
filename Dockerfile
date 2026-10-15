# Hearthnote: zero runtime dependencies, so the image is Node and the source.
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 HEARTH_MODE=demo HEARTH_DATA_DIR=/app/data
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY skills ./skills
COPY public ./public
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["node", "server/main.js"]
