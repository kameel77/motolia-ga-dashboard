# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY prisma ./prisma
RUN npx prisma generate

COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Install prisma CLI for migrations
RUN npm install -g prisma@6

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/src/worker ./src/worker
COPY --from=builder /app/src/lib ./src/lib

# Copy worker dependencies from builder
COPY --from=builder /app/node_modules/@google-analytics ./node_modules/@google-analytics
COPY --from=builder /app/node_modules/google-auth-library ./node_modules/google-auth-library
COPY --from=builder /app/node_modules/google-gax ./node_modules/google-gax
COPY --from=builder /app/node_modules/node-cron ./node_modules/node-cron
COPY --from=builder /app/node_modules/csv-parse ./node_modules/csv-parse
COPY --from=builder /app/node_modules/ioredis ./node_modules/ioredis
COPY --from=builder /app/node_modules/jsonwebtoken ./node_modules/jsonwebtoken

# Start script
COPY start.sh ./start.sh
RUN chmod +x start.sh

# Run migrations as root, then switch to nextjs
RUN chown -R nextjs:nodejs /app

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["./start.sh"]
