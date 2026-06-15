FROM node:22-alpine AS builder

WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm ci 2>/dev/null || npm install
COPY server/tsconfig.json ./
COPY VERSION ./
COPY server/src ./src
RUN npm run build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY VERSION ./VERSION

EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
