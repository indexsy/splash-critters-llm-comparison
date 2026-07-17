FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache python3 make g++ libstdc++
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY packages ./packages
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
