#!/bin/sh
set -e

echo "Running database migrations..."
prisma migrate deploy --schema=./prisma/schema.prisma || echo "Migration skipped (no migrations directory yet)"

echo "Starting cron worker in background..."
node src/worker/cron.js &

echo "Starting Next.js server..."
exec node server.js
