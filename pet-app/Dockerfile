FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./package.json
COPY pet-app/*.mjs ./pet-app/
COPY pet-app/public/ ./pet-app/public/
ENV NODE_ENV=production PET_HOST=0.0.0.0 PORT=10000 PET_DATA_DIR=/var/lib/dafeyu
EXPOSE 10000
CMD ["node", "pet-app/server.mjs"]
