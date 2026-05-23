FROM node:20-slim

# Prisma necesita openssl + ca-certificates (Debian slim no los trae).
# slim+Debian es el target más fiable para el motor de Prisma (evita los
# problemas de musl/openssl de Alpine).
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY prisma ./prisma
RUN npx prisma generate

COPY . .

RUN mkdir -p /app/uploads

EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
