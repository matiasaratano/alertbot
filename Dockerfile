FROM node:22-bookworm-slim
WORKDIR /app
COPY . .
RUN npm test
ENV NODE_ENV=production
ENV ALERTBOT_DATA_DIR=/data
CMD ["node", "worker.mjs"]
