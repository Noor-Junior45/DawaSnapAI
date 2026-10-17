#!/usr/bin/env bash
# ==============================================================================
# Setup Google Cloud Scheduler for DawaSnap AI
#
# This script provisions Cloud Scheduler cron jobs to trigger automated 
# background tasks on your Google Cloud Run instance:
#   1. Daily Medicine Expiry Checker (runs daily at 9:00 AM)
#   2. Cloud Backup Sync (runs daily at 2:00 AM and 2:00 PM)
# ==============================================================================

set -euo pipefail

# Configuration Defaults
PROJECT_ID="${GCP_PROJECT_ID:-gen-lang-client-0044881146}"
REGION="${GCP_REGION:-asia-southeast1}"
CLOUD_RUN_SERVICE="${CLOUD_RUN_SERVICE_NAME:-dawasnap-ai}"
SERVICE_URL="${CLOUD_RUN_URL:-https://ais-dev-tu4ek2okojl5m7fb2lx2x5-570007657295.asia-southeast1.run.app}"
CRON_SECRET="${CRON_SECRET:-dawasnap_cron_secret_secure_key}"
TIMEZONE="${CRON_TIMEZONE:-Asia/Kolkata}"

echo "=========================================================="
echo " Setting up Cloud Scheduler for DawaSnap AI"
echo " Project:   ${PROJECT_ID}"
echo " Region:    ${REGION}"
echo " URL:       ${SERVICE_URL}"
echo " Timezone:  ${TIMEZONE}"
echo "=========================================================="

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
  echo "Error: gcloud CLI is not installed or not in PATH."
  echo "You can run this directly in Google Cloud Shell: https://shell.cloud.google.com"
  exit 1
fi

# Set project context
gcloud config set project "${PROJECT_ID}"

# Enable Cloud Scheduler API if not already enabled
echo "Ensuring cloudscheduler.googleapis.com is enabled..."
gcloud services enable cloudscheduler.googleapis.com

# ------------------------------------------------------------------------------
# Job 1: Daily Medicine Expiry Checker (09:00 AM daily)
# ------------------------------------------------------------------------------
JOB_EXPIRY="dawasnap-daily-expiry-check"
echo "Creating/Updating Cloud Scheduler job: ${JOB_EXPIRY}..."

if gcloud scheduler jobs describe "${JOB_EXPIRY}" --location="${REGION}" &> /dev/null; then
  echo "Updating existing job ${JOB_EXPIRY}..."
  gcloud scheduler jobs update http "${JOB_EXPIRY}" \
    --location="${REGION}" \
    --schedule="0 9 * * *" \
    --time-zone="${TIMEZONE}" \
    --uri="${SERVICE_URL}/api/cron/check-expiry" \
    --http-method="POST" \
    --headers="x-cron-secret=${CRON_SECRET},Content-Type=application/json" \
    --description="Daily check for expiring medicines and automated email/push notifications"
else
  echo "Creating new job ${JOB_EXPIRY}..."
  gcloud scheduler jobs create http "${JOB_EXPIRY}" \
    --location="${REGION}" \
    --schedule="0 9 * * *" \
    --time-zone="${TIMEZONE}" \
    --uri="${SERVICE_URL}/api/cron/check-expiry" \
    --http-method="POST" \
    --headers="x-cron-secret=${CRON_SECRET},Content-Type=application/json" \
    --description="Daily check for expiring medicines and automated email/push notifications"
fi

# ------------------------------------------------------------------------------
# Job 2: Supabase Secondary Cloud Backup Sync (2:00 AM and 2:00 PM daily)
# ------------------------------------------------------------------------------
JOB_SYNC="dawasnap-supabase-backup-sync"
echo "Creating/Updating Cloud Scheduler job: ${JOB_SYNC}..."

if gcloud scheduler jobs describe "${JOB_SYNC}" --location="${REGION}" &> /dev/null; then
  echo "Updating existing job ${JOB_SYNC}..."
  gcloud scheduler jobs update http "${JOB_SYNC}" \
    --location="${REGION}" \
    --schedule="0 2,14 * * *" \
    --time-zone="${TIMEZONE}" \
    --uri="${SERVICE_URL}/api/cron/sync" \
    --http-method="POST" \
    --headers="x-cron-secret=${CRON_SECRET},Content-Type=application/json" \
    --description="Automated backup sync between Firestore and Supabase"
else
  echo "Creating new job ${JOB_SYNC}..."
  gcloud scheduler jobs create http "${JOB_SYNC}" \
    --location="${REGION}" \
    --schedule="0 2,14 * * *" \
    --time-zone="${TIMEZONE}" \
    --uri="${SERVICE_URL}/api/cron/sync" \
    --http-method="POST" \
    --headers="x-cron-secret=${CRON_SECRET},Content-Type=application/json" \
    --description="Automated backup sync between Firestore and Supabase"
fi

echo "=========================================================="
echo " Cloud Scheduler setup completed successfully!"
echo " Jobs configured:"
echo "   - ${JOB_EXPIRY} (09:00 AM ${TIMEZONE} -> /api/cron/check-expiry)"
echo "   - ${JOB_SYNC}   (02:00 AM & 02:00 PM ${TIMEZONE} -> /api/cron/sync)"
echo "=========================================================="
