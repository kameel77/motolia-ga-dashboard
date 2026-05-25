#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma migrate deploy

echo "Starting cron worker in background..."
node src/worker/cron.js &

echo "Starting Next.js server..."
exec node server.js
