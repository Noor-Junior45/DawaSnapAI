# Google Cloud Run Deployment Guide (Region: asia-south1)
**Application:** DawaSnap AI Backend Microservice  
**Target Architecture:** Fully Managed Container on Google Cloud Run  
**Region:** `asia-south1` (Mumbai, India)  
**Document Reference:** `DAWASNAP-CLOUDRUN-DEPLOY-2026-V1.0`

---

## Complete Server Environment Variables Inventory

Every `process.env.*` variable read by `server.ts` and `server/*` in this codebase is cataloged below:

| Variable Name | Type | Sensitivity | Required / Optional | Code Location | Description & Usage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`GEMINI_API_KEY`** | Secret | 🔒 Secret | **Required** | `server/aiService.ts:10`, `server.ts:343` | Google Gemini API key for vision extraction, drug interaction screening, categorization, and pharmacist chat. |
| **`API_KEY`** | Secret | 🔒 Secret | Optional (Fallback) | `server/aiService.ts:10` | Fallback alias for `GEMINI_API_KEY` if standard variable is unset. |
| **`SUPABASE_SERVICE_ROLE_KEY`** | Secret | 🔒 Secret | **Required** (for Supabase) | `server/supabaseBackup.ts:5` | Supabase service-role key with administrative privileges to bypass RLS for backups. |
| **`CRON_SECRET`** | Secret | 🔒 Secret | **Required** | `server.ts:209`, `server.ts:343` | High-entropy token required in `x-cron-secret` header for Cloud Scheduler cron jobs and disaster recovery endpoints. |
| **`RESEND_API_KEY`** | Secret | 🔒 Secret | **Required** (for Alerts) | `server.ts:419`, `server.ts:557`, `server/emailTemplates.ts:269` | Resend API key for transactional expiration notifications and account deletion confirmation emails. |
| **`FIREBASE_SERVICE_ACCOUNT_KEY`** | Secret | 🔒 Secret | Optional on Cloud Run | `server/firebaseAdmin.ts:15` | Firebase Admin credentials JSON. When omitted on Cloud Run, the server automatically uses **Application Default Credentials (ADC)** from the attached IAM service account. |
| **`SUPABASE_URL`** | Config | 🌐 Plain | **Required** (for Supabase) | `server/supabaseBackup.ts:4` | Supabase project HTTPS endpoint (e.g. `https://kizepsjjgznzuewwgemt.supabase.co`). |
| **`PUBLIC_BASE_URL`** | Config | 🌐 Plain | **Required** | `server.ts:58`, `server.ts:416` | Canonical public HTTPS base URL (e.g. `https://api.dawasnap.in`). Used to formulate user account deletion verification links. |
| **`ALLOWED_ORIGINS`** | Config | 🌐 Plain | **Required** | `server.ts:84` | Comma-separated list of web origins permitted by CORS (e.g. `https://dawasnap.vercel.app,https://dawasnap.in,https://www.dawasnap.in`). |
| **`PORT`** | Config | 🌐 Plain | Optional (Auto) | `server.ts:57` | Port for the HTTP server to listen on. Google Cloud Run automatically injects `8080`. |
| **`NODE_ENV`** | Config | 🌐 Plain | **Required** | `server.ts:1134` | Set to `production` in container to serve precompiled `dist/` bundle and bypass Vite development middleware. |
| **`K_SERVICE`** | System | 🌐 Plain (Auto) | System Managed | `server.ts:1134`, `server.ts:1163` | Injected automatically by Google Cloud Run. Informs `server.ts` to activate serverless mode (`isServerless = true`), disabling in-process intervals and keep-alives. |
| **`ENFORCE_APP_CHECK`** | Config | 🌐 Plain | Optional | `server.ts:226`, `server.ts:239` | If set to `"true"`, enforces Firebase App Check token verification on incoming client requests. |
| **`GOOGLE_APPLICATION_CREDENTIALS`** | System | 🌐 Plain | Optional | `server/firebaseAdmin.ts:16` | Path to credentials file. On Cloud Run, Google metadata server supplies credentials automatically via ADC. |
| **`VERCEL` / `AWS_LAMBDA_FUNCTION_NAME`** | System | 🌐 Plain | Optional | `server.ts:1134`, `server.ts:1163` | Alternative serverless flags checked alongside `K_SERVICE`. |

---

## 1. One-Time Google Cloud Project Setup

Run these commands in your local terminal or Google Cloud Shell:

```bash
# Set your target project ID and default deployment region
export PROJECT_ID="YOUR_PROJECT_ID"
export REGION="asia-south1"

gcloud config set project ${PROJECT_ID}
gcloud config set run/region ${REGION}

# Enable all required Google Cloud APIs
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com
```

---

## 2. Secret Manager Configuration

Store sensitive credentials in Google Secret Manager. Secrets are mounted directly into Cloud Run at runtime without exposing keys in plain text.

```bash
# 1. Google Gemini API Key
echo -n "YOUR_GEMINI_API_KEY_HERE" | gcloud secrets create GEMINI_API_KEY \
  --data-file=- \
  --replication-policy="automatic"

# 2. Supabase Service Role Secret Key (Bypasses RLS for server backups)
echo -n "YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE" | gcloud secrets create SUPABASE_SERVICE_ROLE_KEY \
  --data-file=- \
  --replication-policy="automatic"

# 3. High-Entropy CRON Secret (Used by Cloud Scheduler and disaster recovery)
# Generate a strong 64-character secret or use your existing one
export GENERATED_CRON_SECRET=$(openssl rand -hex 32)
echo -n "${GENERATED_CRON_SECRET}" | gcloud secrets create CRON_SECRET \
  --data-file=- \
  --replication-policy="automatic"

# 4. Resend Transactional Email API Key
echo -n "YOUR_RESEND_API_KEY_HERE" | gcloud secrets create RESEND_API_KEY \
  --data-file=- \
  --replication-policy="automatic"
```

*(Note: If you ever need to rotate a secret, run `echo -n "NEW_SECRET_VALUE" | gcloud secrets versions add SECRET_NAME --data-file=-`)*

---

## 3. Dedicated Runtime Service Account (Least Privilege)

Create a dedicated service account for Cloud Run with only the exact IAM roles required for Firestore, Firebase Auth, FCM, and Secret Manager access:

```bash
# 1. Create the dedicated service account
export SA_NAME="dawasnap-cloudrun-sa"
export SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create ${SA_NAME} \
  --display-name="DawaSnap AI Cloud Run Runtime Account" \
  --description="Least privilege runtime service account for DawaSnap AI backend container"

# 2. Grant Cloud Datastore / Firestore User (Database read/write)
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/datastore.user"

# 3. Grant Firebase Authentication Viewer (Read user profiles and verify ID tokens)
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/firebaseauth.viewer"

# 4. Grant Firebase Cloud Messaging Admin (Dispatch FCM push notifications to devices)
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/firebasecloudmessaging.admin"

# 5. Grant Secret Manager Secret Accessor (Read secrets at container startup)
gcloud projects add-iam-policy-binding ${PROJECT_ID} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/secretmanager.secretAccessor"
```

---

## 4. Deploy to Google Cloud Run

Deploy directly from the repository root directory. Cloud Build packages the container according to `Dockerfile` and deploys it to Cloud Run:

```bash
# Define your domain and allowed CORS origins
export PUBLIC_BASE_URL="https://api.dawasnap.in"
export ALLOWED_ORIGINS="https://dawasnap.vercel.app,https://dawasnap.in,https://www.dawasnap.in"
export SUPABASE_URL="https://kizepsjjgznzuewwgemt.supabase.co"

# Deploy service
gcloud run deploy dawasnap-api \
  --source . \
  --region asia-south1 \
  --service-account "${SA_EMAIL}" \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 2 \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 40 \
  --timeout 900 \
  --set-secrets "\
GEMINI_API_KEY=GEMINI_API_KEY:latest,\
SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,\
CRON_SECRET=CRON_SECRET:latest,\
RESEND_API_KEY=RESEND_API_KEY:latest" \
  --set-env-vars "\
NODE_ENV=production,\
PUBLIC_BASE_URL=${PUBLIC_BASE_URL},\
ALLOWED_ORIGINS=${ALLOWED_ORIGINS},\
SUPABASE_URL=${SUPABASE_URL}"
```

Once deployment completes, note down the deployed Cloud Run service URL:
```bash
export SERVICE_URL=$(gcloud run services describe dawasnap-api --region asia-south1 --format="value(status.url)")
echo "Deployed Service URL: ${SERVICE_URL}"
```

---

## 5. Google Cloud Scheduler Jobs

Because Cloud Run throttles container CPU after an HTTP response is delivered, background schedulers run strictly via Google Cloud Scheduler.

Retrieve your stored `CRON_SECRET`:
```bash
export CRON_SECRET_VALUE=$(gcloud secrets versions access latest --secret="CRON_SECRET")
```

### 5.1 Hourly Two-Way Sync (`/api/cron/sync`)
Triggers bidirectional sync between Firestore and Supabase PostgreSQL backup every hour on the hour:

```bash
gcloud scheduler jobs create http dawasnap-hourly-sync \
  --location="asia-south1" \
  --schedule="0 * * * *" \
  --time-zone="UTC" \
  --uri="${SERVICE_URL}/api/cron/sync" \
  --http-method="POST" \
  --headers="x-cron-secret=${CRON_SECRET_VALUE},Content-Type=application/json" \
  --attempt-deadline="600s" \
  --max-retry-attempts=3 \
  --min-backoff="30s" \
  --max-backoff="300s" \
  --max-doublings=3 \
  --description="Hourly Firestore to Supabase backup synchronization"
```

### 5.2 Daily Expiration Assessment (`/api/cron/check-expiry`)
Runs daily at 03:00 UTC (08:30 AM IST) to evaluate upcoming medication expiration dates (30-day, 7-day, and expired stages), dispatching push notifications and deduplicated transactional alert emails:

```bash
gcloud scheduler jobs create http dawasnap-daily-expiry-check \
  --location="asia-south1" \
  --schedule="0 3 * * *" \
  --time-zone="UTC" \
  --uri="${SERVICE_URL}/api/cron/check-expiry" \
  --http-method="POST" \
  --headers="x-cron-secret=${CRON_SECRET_VALUE},Content-Type=application/json" \
  --attempt-deadline="600s" \
  --max-retry-attempts=3 \
  --min-backoff="30s" \
  --max-backoff="300s" \
  --max-doublings=3 \
  --description="Daily medication expiry milestone alert evaluator"
```

---

## 6. Custom Domain Mapping & DNS Records

To bind your custom API domain (e.g., `api.dawasnap.in`):

```bash
# 1. Map custom domain to Cloud Run service
gcloud beta run domain-mappings create \
  --service dawasnap-api \
  --domain api.dawasnap.in \
  --region asia-south1
```

### Required DNS Records
Log into your DNS provider (Cloudflare, GoDaddy, Namecheap, Google Domains) and add the following records:

| Record Type | Host / Name | Target / Value | TTL | Proxy Status |
| :--- | :--- | :--- | :--- | :--- |
| **CNAME** | `api` (or `api.dawasnap.in`) | `ghs.googlehosted.com.` | Auto / 300 | DNS Only (or Proxied if using Cloudflare) |

*Google automatically provisions and renews managed SSL certificates (Let's Encrypt) within 15–30 minutes after DNS propagation.*

---

## 7. Budget Alerts & Cost Protection

To ensure zero billing surprises on Google Cloud Run:

### 7.1 Set Cloud Billing Budget Alert
Create a budget alert (e.g. ₹500 INR or $10 USD/month):
```bash
# Open Billing Budgets in Console or run:
gcloud billing budgets create \
  --billing-account="YOUR_BILLING_ACCOUNT_ID" \
  --display-name="DawaSnap Cloud Run Low Budget Alert" \
  --budget-amount="500INR" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 \
  --all-updates-rule-notification-channels="YOUR_NOTIFICATION_CHANNEL_ID"
```

### 7.2 Strict Concurrency & Scaling Caps
If traffic spikes or unexpected crawler load occurs, immediately cap your service to 1 instance:
```bash
gcloud run services update dawasnap-api \
  --region asia-south1 \
  --min-instances 0 \
  --max-instances 1
```

*(Because `--min-instances 0` is configured, the server scales to zero when idle, incurring **zero compute cost** between user requests.)*

---

## 8. Post-Deployment Verification Checklist

Execute these verification tests against your deployed service:

### 8.1 Health Check (Must Return 200 `{ok:true}`)
```bash
curl -i "${SERVICE_URL}/healthz"
```
**Expected Response:**
```http
HTTP/2 200
content-type: application/json; charset=utf-8

{"ok":true}
```

### 8.2 Unauthenticated Call to Protected API (Must Return 401)
```bash
curl -i -X POST "${SERVICE_URL}/api/backup/two-way-sync"
```
**Expected Response:**
```http
HTTP/2 401
content-type: application/json; charset=utf-8

{"error":"Unauthorized: Missing or malformed Authorization Bearer token header."}
```

### 8.3 Cron Endpoint Without Header (Must Return 401)
```bash
curl -i -X POST "${SERVICE_URL}/api/cron/sync"
```
**Expected Response:**
```http
HTTP/2 401
content-type: application/json; charset=utf-8

{"error":"Unauthorized: A valid x-cron-secret header matching CRON_SECRET is required."}
```

### 8.4 Cron Endpoint With Valid Header (Must Return 200 Success)
```bash
curl -i -X POST "${SERVICE_URL}/api/cron/sync" \
  -H "x-cron-secret: ${CRON_SECRET_VALUE}" \
  -H "Content-Type: application/json"
```
**Expected Response:**
```http
HTTP/2 200
content-type: application/json; charset=utf-8

{"success":true,"timestamp":"...","pushedMedicines":...,"pushedConfigs":...,"pushedUsers":...,"pushedHistory":...,"errors":[]}
```

### 8.5 Inspecting Container Logs
View live streaming logs from your terminal:
```bash
# Read last 50 log entries
gcloud run services logs read dawasnap-api --region asia-south1 --limit 50

# Tail logs live
gcloud run services logs tail dawasnap-api --region asia-south1
```

Or query in **Google Cloud Console → Logs Explorer**:
```text
resource.type="cloud_run_revision"
resource.labels.service_name="dawasnap-api"
resource.labels.location="asia-south1"
```

---

## 9. Rollback & Render Retirement Protocol

### 9.1 Immediate Rollback
If a newly deployed revision encounters unexpected bugs, roll back traffic instantaneously to the previous healthy revision:
```bash
# List previous revisions
gcloud run revisions list --service dawasnap-api --region asia-south1

# Route 100% of traffic to previous revision
gcloud run services update-traffic dawasnap-api \
  --region asia-south1 \
  --to-revisions="dawasnap-api-00001-abc=100"
```

### 9.2 Exact Order for Retiring the Old Render Service
Follow this exact sequence to eliminate any risk of data loss, duplicate notifications, or sync race conditions:

1. **Step 1: Deploy & Test Cloud Run**  
   Confirm all curl verification steps pass on Cloud Run (`/healthz`, `/api/cron/sync`, `/api/cron/check-expiry`).
2. **Step 2: Update Client Routing**  
   - In `vercel.json`, ensure `/api/(.*)` rewrites to your Cloud Run domain (`https://api.dawasnap.in/api/$1`). Deploy Vercel frontend.
   - In your mobile APK release, build with `VITE_BACKEND_URL=https://api.dawasnap.in`.
3. **Step 3: 48-Hour Dual-Run Observation**  
   Monitor Cloud Run logs and Supabase backups for 48 hours to confirm continuous, error-free operation.
4. **Step 4: Disable Render Cron Jobs & Background Schedulers**  
   Navigate to the Render Dashboard and **Suspend / Disable** all Cron Jobs or background worker services to ensure two independent hosts do not send duplicate expiration emails or run conflicting sync operations.
5. **Step 5: Revoke Render Secrets & Delete Service**  
   - Remove `FIREBASE_SERVICE_ACCOUNT_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `GEMINI_API_KEY` from the Render environment.
   - Delete the Render Web Service and verify that no external services still resolve to `*.onrender.com`.
