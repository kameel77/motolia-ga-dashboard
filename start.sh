#!/bin/sh
set -e

echo "Running database migrations..."
prisma migrate deploy --schema=./prisma/schema.prisma || echo "Migration skipped (no migrations directory yet)"

echo "Starting cron worker in background..."
npx tsx src/worker/cron.ts &

echo "Starting Next.js server..."
exec node server.js
