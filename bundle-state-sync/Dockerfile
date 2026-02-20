# ---- Builder stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ---- Production stage ----
FROM node:20-alpine

WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package.json package-lock.json* ./
RUN npm ci

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src

USER appuser

CMD ["node", "dist/index.js"]
