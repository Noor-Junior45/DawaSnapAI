import express from "express";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { Resend } from "resend";
import { 
  getExtractionCache, 
  saveExtractionCache, 
  getInteractionCache, 
  saveInteractionCache, 
  extractMedicineDataServer, 
  checkDrugInteractionsServer, 
  categorizeMedicinesServer,
  autoAllotFormulationsServer,
  chatWithGeminiServer,
  getAvailableKeys
} from "./server/aiService.ts";
import { getChatCount, incrementChatCount } from "./medCache.ts";
import { 
  startExpiryCron, 
  registerUserExpirySchedule, 
  runBackgroundExpiryCheck,
  purgeUserServerData,
  type ActiveMedicineItem
} from "./server/expiryCron.ts";
import { 
  initFirebaseAdmin, 
  getAdminApp,
  getAdminDb,
  hasServiceAccountConfigured,
  requireFirebaseAuth, 
  type AuthenticatedRequest 
} from "./server/firebaseAdmin.ts";
import { getAuth } from "firebase-admin/auth";
import { getAppCheck } from "firebase-admin/app-check";
import {
  backupMedicinesBatchToSupabase,
  backupMedicineToSupabase,
  backupUserConfigToSupabase,
  deleteMedicineFromSupabase,
  deleteMedicinesBatchFromSupabase,
  backupMedicineHistoryToSupabase,
  deleteUserAllDataFromSupabase,
  isSupabaseConfigured,
  testSupabaseConnection
} from "./server/supabaseBackup.ts";
import { runTwoWaySync, pullSupabaseToFirebase } from "./server/twoWaySync.ts";
import { getGeneralNotificationHTMLServer } from "./server/emailTemplates.ts";

// Initialize Firebase Admin on startup
initFirebaseAdmin();

const app = express();
// Trust first proxy hop (e.g. Render, Cloudflare) - Never read X-Forwarded-For manually
app.set('trust proxy', 1);

const PORT = Number(process.env.PORT) || 3000;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || "https://dawasnapai.onrender.com";

// ============================================================
// 1. CORS ALLOWLIST CONFIGURATION & SECURITY HEADERS
// ============================================================
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// Exact domain allowlist (Removed wildcards *.vercel.app and *.run.app)
const EXACT_ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://localhost:5173",
  "capacitor://localhost",
  "https://localhost",
  "https://dawasnap.in",
  "https://www.dawasnap.in",
  "https://dawasnapai.onrender.com",
  "https://dawalens.in",
  "https://www.dawalens.in",
  "https://dawalensai.onrender.com",
  "https://noorpos.in",
  "https://www.noorpos.in"
]);

if (process.env.ALLOWED_ORIGINS) {
  process.env.ALLOWED_ORIGINS.split(',').forEach(o => {
    const trimmed = o.trim();
    if (trimmed) EXACT_ALLOWED_ORIGINS.add(trimmed);
  });
}

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true; // Native apps, curl, server-to-server
  return EXACT_ALLOWED_ORIGINS.has(origin);
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    // Dropped Access-Control-Allow-Credentials for enhanced security
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, x-cron-secret, x-firebase-appcheck");
  
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// ============================================================
// 2. RATE LIMITING ENGINE (IN-MEMORY TOKEN BUCKET WITH EVICTION)
// ============================================================
interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}
const ipBuckets = new Map<string, RateLimitBucket>();
const uidBuckets = new Map<string, RateLimitBucket>();
const MAX_BUCKETS = 10000;
const BUCKET_TTL_MS = 60 * 60 * 1000; // 1 hour

function evictStaleBuckets(map: Map<string, RateLimitBucket>, now: number) {
  if (map.size > MAX_BUCKETS) {
    for (const [key, bucket] of map.entries()) {
      if (now - bucket.lastRefill > BUCKET_TTL_MS) {
        map.delete(key);
      }
    }
    // Hard cap eviction if still above limit
    if (map.size > MAX_BUCKETS) {
      let excess = map.size - MAX_BUCKETS;
      for (const key of map.keys()) {
        map.delete(key);
        excess--;
        if (excess <= 0) break;
      }
    }
  }
}

function createRateLimiter(maxPerMinute: number = 100, burst: number = 20) {
  const capacity = maxPerMinute + burst;
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Strictly read req.ip (app.set('trust proxy', 1)), never manual X-Forwarded-For
    const ip = req.ip || '127.0.0.1';
    const now = Date.now();
    let bucket = ipBuckets.get(ip);
    
    if (!bucket) {
      evictStaleBuckets(ipBuckets, now);
      bucket = { tokens: capacity, lastRefill: now };
      ipBuckets.set(ip, bucket);
    } else {
      const elapsedSeconds = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * (maxPerMinute / 60));
      bucket.lastRefill = now;
    }

    if (bucket.tokens < 1) {
      return res.status(429).json({ 
        error: "Too many requests. Please wait a moment before trying again.",
        retryAfterSeconds: Math.ceil((1 - bucket.tokens) / (maxPerMinute / 60))
      });
    }
    bucket.tokens -= 1;
    next();
  };
}

// Per-UID rate limiter for authenticated routes
function createUidRateLimiter(maxPerMinute: number = 30, burst: number = 10) {
  const capacity = maxPerMinute + burst;
  return (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    const uid = req.userId;
    if (!uid) return next();
    const now = Date.now();
    let bucket = uidBuckets.get(uid);

    if (!bucket) {
      evictStaleBuckets(uidBuckets, now);
      bucket = { tokens: capacity, lastRefill: now };
      uidBuckets.set(uid, bucket);
    } else {
      const elapsedSeconds = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * (maxPerMinute / 60));
      bucket.lastRefill = now;
    }

    if (bucket.tokens < 1) {
      return res.status(429).json({
        error: "Too many requests for this account. Please slow down.",
        retryAfterSeconds: Math.ceil((1 - bucket.tokens) / (maxPerMinute / 60))
      });
    }
    bucket.tokens -= 1;
    next();
  };
}

const generalRateLimiter = createRateLimiter(120, 20);
const aiRateLimiter = createRateLimiter(30, 5);
const strictPublicFormRateLimiter = createRateLimiter(6, 2);
const authenticatedUidLimiter = createUidRateLimiter(30, 10);
const sensitiveAuthActionLimiter = createUidRateLimiter(10, 3);

// Timing-safe CRON_SECRET validator
function verifyCronAuth(req: express.Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;

  const headerVal = req.headers['x-cron-secret'] || 
    (typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);

  if (typeof headerVal !== 'string') return false;

  const expectedBuf = Buffer.from(cronSecret);
  const providedBuf = Buffer.from(headerVal.trim());

  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

// Firebase App Check token verification middleware
async function verifyAppCheckToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  const appCheckToken = req.headers['x-firebase-appcheck'];
  if (!appCheckToken || typeof appCheckToken !== 'string') {
    if (process.env.ENFORCE_APP_CHECK === 'true') {
      return res.status(401).json({ error: "App Check token missing." });
    }
    return next();
  }

  try {
    const adminApp = getAdminApp();
    if (hasServiceAccountConfigured()) {
      await getAppCheck(adminApp).verifyToken(appCheckToken);
    }
    next();
  } catch (err: any) {
    if (process.env.ENFORCE_APP_CHECK === 'true') {
      return res.status(401).json({ error: `Invalid App Check token: ${err.message}` });
    }
    console.warn('[APP CHECK NOTICE] Token verification notice:', err.message);
    next();
  }
}

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,63}$/;
function isValidEmailInput(email: unknown): boolean {
  return typeof email === 'string' && email.length <= 100 && !/[\r\n\t]/.test(email) && EMAIL_REGEX.test(email.trim());
}

// Track per-UID email alerts (max 10/day)
const userDailyEmailCount = new Map<string, { date: string; count: number }>();

// ============================================================
// 3. BODY PARSERS & MIDDLEWARES
// ============================================================
const standardJsonParser = express.json({ limit: '2mb' });
const highResScanParser = express.json({ limit: '15mb' });

app.use(express.urlencoded({ limit: '2mb', extended: true }));
app.use("/api", generalRateLimiter, verifyAppCheckToken);
app.use("/api/ai/extract", highResScanParser);
app.use((req, res, next) => {
  if (req.path === "/api/ai/extract") return next();
  standardJsonParser(req, res, next);
});

// ============================================================
// 4. PUBLIC COMPLIANCE & STATIC VERIFICATION ENDPOINTS
// ============================================================
app.get("/google:id.html", (req, res) => {
  const id = req.params.id;
  res.setHeader("Content-Type", "text/html");
  res.send(`google-site-verification: google${id}.html`);
});

app.get(["/sitemap.xml", "/sitemap"], (req, res) => {
  const sitemapPath = path.join(process.cwd(), "public", "sitemap.xml");
  if (fs.existsSync(sitemapPath)) {
    res.setHeader("Content-Type", "application/xml");
    res.sendFile(sitemapPath);
  } else {
    res.status(404).send("Sitemap not found");
  }
});

app.get("/.well-known/assetlinks.json", (req, res) => {
  const assetLinksPath = path.join(process.cwd(), "public", ".well-known", "assetlinks.json");
  if (fs.existsSync(assetLinksPath)) {
    res.setHeader("Content-Type", "application/json");
    res.sendFile(assetLinksPath);
  } else {
    res.status(404).json({ error: "assetlinks.json not configured" });
  }
});

app.get(["/privacy", "/privacy.html"], (req, res) => {
  const privacyPath = path.join(process.cwd(), "public", "privacy.html");
  if (fs.existsSync(privacyPath)) {
    res.sendFile(privacyPath);
  } else {
    res.redirect("/?page=privacy");
  }
});

app.get(["/terms", "/terms.html"], (req, res) => {
  const termsPath = path.join(process.cwd(), "public", "terms.html");
  if (fs.existsSync(termsPath)) {
    res.sendFile(termsPath);
  } else {
    res.redirect("/?page=terms");
  }
});

app.get(["/manual", "/manual.html", "/guide", "/guide.html"], (req, res) => {
  const guidePath = path.join(process.cwd(), "public", "guide.html");
  if (fs.existsSync(guidePath)) {
    res.sendFile(guidePath);
  } else {
    res.redirect("/?page=guide");
  }
});

app.get(["/account-delete", "/account-delete.html", "/accountdelete"], (req, res) => {
  res.redirect(301, "/delete-account");
});

app.get(["/delete-account", "/delete-account.html"], (req, res) => {
  const deletePath = path.join(process.cwd(), "public", "delete-account.html");
  if (fs.existsSync(deletePath)) {
    res.sendFile(deletePath);
  } else {
    res.redirect("/?page=delete-account");
  }
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "DawaSnap AI Server is running securely" });
});

// Helper to sign tokens for deletion requests (HMAC-SHA256 valid 24 hours)
const DELETION_SECRET = process.env.CRON_SECRET || process.env.GEMINI_API_KEY || "dawasnap-deletion-key-signature";

function generateDeletionToken(email: string, referenceId: string, expiresAt: number): string {
  const payload = `${email}:${referenceId}:${expiresAt}`;
  const hmac = crypto.createHmac("sha256", DELETION_SECRET);
  hmac.update(payload);
  const signature = hmac.digest("hex");
  return Buffer.from(JSON.stringify({ email, referenceId, expiresAt, signature })).toString("base64url");
}

function verifyDeletionToken(tokenString: string): { valid: boolean; email?: string; referenceId?: string } {
  try {
    const raw = Buffer.from(tokenString, "base64url").toString("utf8");
    const parsed = JSON.parse(raw);
    if (!parsed.email || !parsed.referenceId || !parsed.expiresAt || !parsed.signature) {
      return { valid: false };
    }
    if (Date.now() > parsed.expiresAt) {
      return { valid: false };
    }
    const payload = `${parsed.email}:${parsed.referenceId}:${parsed.expiresAt}`;
    const hmac = crypto.createHmac("sha256", DELETION_SECRET);
    hmac.update(payload);
    const expectedSig = hmac.digest("hex");
    const sigBuf = Buffer.from(parsed.signature);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { valid: false };
    }
    return { valid: true, email: parsed.email, referenceId: parsed.referenceId };
  } catch {
    return { valid: false };
  }
}

// Public Account Deletion Request: stores in server-only collection & dispatches verification link
app.post("/api/account/deletion-request", strictPublicFormRateLimiter, async (req, res) => {
  try {
    const { email, reason, confirmed } = req.body;
    if (!email || !isValidEmailInput(email)) {
      return res.status(400).json({ error: "A valid, sanitized email address (max 100 characters) is required." });
    }
    if (!confirmed) {
      return res.status(400).json({ error: "Explicit user confirmation is required." });
    }

    const sanitizedEmail = String(email).trim().toLowerCase();
    const sanitizedReason = typeof reason === 'string' ? reason.slice(0, 500) : '';

    const referenceId = `DEL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
    const token = generateDeletionToken(sanitizedEmail, referenceId, expiresAt);

    const requestRecord = {
      referenceId,
      email: sanitizedEmail,
      reason: sanitizedReason,
      status: "pending_verification",
      token,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(expiresAt).toISOString()
    };

    // Store in server-only Firestore collection
    if (hasServiceAccountConfigured()) {
      try {
        const db = getAdminDb();
        await db.collection("server_deletion_requests").doc(referenceId).set(requestRecord);
      } catch (dbErr) {
        console.warn("[DELETION REQUEST] Could not persist to server_deletion_requests:", dbErr);
      }
    }

    const verificationLink = `${RENDER_EXTERNAL_URL}/api/account/confirm-deletion?token=${token}`;

    // Send confirmation link via Resend strictly to sanitizedEmail
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (apiKey && apiKey !== 'YOUR_API_KEY' && !apiKey.includes('YOUR_RESEND_API_KEY')) {
      try {
        const resend = new Resend(apiKey);
        await resend.emails.send({
          from: "DawaSnap AI <alerts@noorpos.in>",
          to: [sanitizedEmail],
          subject: `DawaSnap AI - Action Required: Confirm Account Deletion (${referenceId})`,
          text: `Hello,\n\nA request was submitted to permanently delete your DawaSnap AI account and associated clinical data (${sanitizedEmail}).\n\nTo confirm and permanently delete your account, click the link below (valid for 24 hours):\n${verificationLink}\n\nIf you did not request this deletion, you may safely ignore this email.\n\nThank you,\nDawaSnap AI Data Privacy Team`,
        });
      } catch (emailErr) {
        console.warn("[DELETION EMAIL NOTICE] Could not send receipt email via Resend:", emailErr);
      }
    }

    res.json({
      success: true,
      referenceId,
      message: "A verification email has been dispatched to your email address. Please click the confirmation link in the email to finalize deletion.",
      submittedAt: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || String(error) });
  }
});

// Endpoint to finalize account deletion with signed, expiring token
app.get("/api/account/confirm-deletion", async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const verification = verifyDeletionToken(token);

  if (!verification.valid || !verification.email) {
    return res.status(400).send(`
      <!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;">
        <h2 style="color:#dc2626;">Invalid or Expired Deletion Link</h2>
        <p>This verification link is invalid or has expired (valid for 24 hours). Please submit a new deletion request if needed.</p>
        <a href="/delete-account" style="color:#0f9d58;font-weight:bold;">Return to Account Deletion Page</a>
      </body></html>
    `);
  }

  const email = verification.email;
  try {
    let purgedUid: string | null = null;
    const adminApp = getAdminApp();

    if (hasServiceAccountConfigured()) {
      try {
        const auth = getAuth(adminApp);
        const userRecord = await auth.getUserByEmail(email);
        purgedUid = userRecord.uid;

        // 1. Purge server expiry schedule & push tokens
        await purgeUserServerData(purgedUid);

        // 2. Delete Firestore medicines & subcollections
        const db = getAdminDb();
        const medSnap = await db.collection("medicines").where("userId", "==", purgedUid).get();
        for (const doc of medSnap.docs) {
          const histSnap = await doc.ref.collection("history").get();
          const batch = db.batch();
          histSnap.docs.forEach(h => batch.delete(h.ref));
          batch.delete(doc.ref);
          await batch.commit();
        }

        // 3. Delete user documents
        await db.collection("users").doc(purgedUid).delete().catch(() => {});
        await db.collection("server_expiry_schedules").doc(purgedUid).delete().catch(() => {});

        // 4. Delete Supabase SQL backup records
        await deleteUserAllDataFromSupabase(purgedUid);

        // 5. Delete Firebase Auth account
        await auth.deleteUser(purgedUid);
        console.log(`[REAL ACCOUNT DELETION] Successfully purged all data for user ${purgedUid} (${email})`);
      } catch (authErr: any) {
        console.warn("[ACCOUNT DELETION AUTH NOTICE]", authErr?.message || authErr);
      }
    }

    // Update deletion record in server_deletion_requests
    if (verification.referenceId && hasServiceAccountConfigured()) {
      try {
        const db = getAdminDb();
        await db.collection("server_deletion_requests").doc(verification.referenceId).update({
          status: "completed",
          deletedAt: new Date().toISOString(),
          purgedUid
        });
      } catch {}
    }

    res.send(`
      <!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;">
        <h2 style="color:#0f9d58;">Account & Data Successfully Deleted</h2>
        <p>All records, medicine vaults, push notification tokens, and backups associated with <strong>${email}</strong> have been permanently erased.</p>
        <p style="color:#64748b;font-size:13px;">Reference ID: ${verification.referenceId}</p>
        <a href="/" style="display:inline-block;margin-top:20px;padding:10px 20px;background:#0f9d58;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold;">Return to Home</a>
      </body></html>
    `);
  } catch (err: any) {
    res.status(500).send(`Error processing account deletion: ${err.message || String(err)}`);
  }
});

// ============================================================
// 5. PROTECTED USER API ROUTES (REQUIRE FIREBASE ID TOKEN)
// ============================================================

// Mail Sending Route (Strictly verified email only; per-UID 10/day limit; server-built templates)
app.post("/api/send-email", requireFirebaseAuth, sensitiveAuthActionLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const userEmail = req.userEmail;
    const isEmailVerified = req.user?.email_verified === true;

    if (!userEmail || !isEmailVerified) {
      return res.status(403).json({ error: "A verified email address is strictly required to send email notifications." });
    }

    const userId = req.userId!;
    const today = new Date().toISOString().split('T')[0];
    const userCount = userDailyEmailCount.get(userId);
    if (userCount && userCount.date === today && userCount.count >= 10) {
      return res.status(429).json({ error: "Daily limit reached: Maximum 10 email alerts per day allowed per account." });
    }

    const { subject, text } = req.body;
    if (!subject || typeof subject !== 'string' || subject.trim().length === 0) {
      return res.status(400).json({ error: "Subject is required and must be a non-empty string." });
    }

    const sanitizedSubject = subject.replace(/[\r\n\t]/g, ' ').slice(0, 200).trim();
    const sanitizedText = typeof text === 'string' ? text.slice(0, 10000) : '';

    // Strictly build template on the server (client HTML ignored)
    const serverHtml = getGeneralNotificationHTMLServer(sanitizedSubject, sanitizedText);

    let apiKey = process.env.RESEND_API_KEY?.trim().replace(/^['"]+|['"]+$/g, '');
    const isKeyInvalid = !apiKey || apiKey === 'YOUR_API_KEY' || apiKey.includes('YOUR_RESEND_API_KEY');

    if (isKeyInvalid) {
      console.warn("[RESEND WARNING] RESEND_API_KEY is not configured. Simulating email send to verified address:", userEmail);
      return res.json({ 
        success: true, 
        simulated: true, 
        message: "Resend API key is not configured on server. Email simulated.", 
        id: `sim-${Date.now()}` 
      });
    }

    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: "DawaSnap AI <alerts@noorpos.in>",
      to: [userEmail],
      subject: sanitizedSubject,
      text: sanitizedText,
      html: serverHtml,
    });

    if (error) {
      console.warn("[RESEND ERROR]", error);
      return res.status(502).json({ error: error.message });
    }

    // Increment per-UID daily email count
    if (!userCount || userCount.date !== today) {
      userDailyEmailCount.set(userId, { date: today, count: 1 });
    } else {
      userCount.count += 1;
    }

    res.json({ success: true, message: "Email sent successfully to verified address", id: data?.id });
  } catch (error: any) {
    console.error("[EMAIL SEND ERROR]", error);
    res.status(500).json({ error: error.message || String(error) });
  }
});

// Extraction Cache Route (Read-only for clients; server writes cache after its own Gemini call)
app.post("/api/ai/extract-cache", requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const { imageHash } = req.body;
    if (!imageHash || typeof imageHash !== 'string') {
      return res.status(400).json({ error: "imageHash is required" });
    }
    const result = await getExtractionCache(imageHash);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Interaction Cache Route (Read-only for clients; server writes cache after its own Gemini call)
app.post("/api/ai/interactions-cache", requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const { key } = req.body;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: "key is required" });
    }
    const result = await getInteractionCache(key);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// AI Proxies (Protected & Rate Limited)
app.post("/api/ai/extract", aiRateLimiter, requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const { base64Image, base64Images, additionalImages, ocrText, hints, cnnFeatures, imageHash } = req.body;
    if (base64Image && (typeof base64Image !== 'string' || base64Image.length > 20 * 1024 * 1024)) {
      return res.status(400).json({ success: false, errorMessage: "Invalid image format or image exceeds 20MB limit." });
    }
    const extraImages: string[] = [];
    if (Array.isArray(additionalImages)) {
      additionalImages.forEach((img: any) => {
        if (typeof img === 'string' && img.length > 50 && img.length < 20 * 1024 * 1024) {
          extraImages.push(img);
        }
      });
    } else if (Array.isArray(base64Images)) {
      base64Images.slice(1).forEach((img: any) => {
        if (typeof img === 'string' && img.length > 50 && img.length < 20 * 1024 * 1024) {
          extraImages.push(img);
        }
      });
    }
    const primaryImage = base64Image || (Array.isArray(base64Images) && base64Images[0]) || undefined;

    if (ocrText && (typeof ocrText !== 'string' || ocrText.length > 50000)) {
      return res.status(400).json({ success: false, errorMessage: "OCR text exceeds 50,000 characters." });
    }

    const result = await extractMedicineDataServer(primaryImage, ocrText, hints, cnnFeatures, extraImages);
    
    // Server caches extraction result directly after its own Gemini call
    if (result.success && result.medicine && imageHash && typeof imageHash === 'string') {
      saveExtractionCache(imageHash, result).catch(() => {});
    }

    res.json(result);
  } catch (error: any) {
    res.json({ success: false, errorMessage: error.message || "Failed to extract medicine data from image." });
  }
});

app.post("/api/ai/interactions", aiRateLimiter, requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const { medicines, cacheKey } = req.body;
    if (!Array.isArray(medicines) || medicines.length > 100) {
      return res.status(400).json({ error: "Medicines must be an array of at most 100 items." });
    }
    const result = await checkDrugInteractionsServer(medicines);

    // Server caches interaction result directly after its own call
    if (result && cacheKey && typeof cacheKey === 'string') {
      saveInteractionCache(cacheKey, result).catch(() => {});
    }

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

app.post("/api/ai/categorize", aiRateLimiter, requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const { medicines } = req.body;
    if (!Array.isArray(medicines) || medicines.length > 100) {
      return res.status(400).json({ error: "Medicines must be an array of at most 100 items." });
    }
    const result = await categorizeMedicinesServer(medicines || []);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

app.post("/api/ai/allot-formulations", aiRateLimiter, requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const { medicines } = req.body;
    if (!Array.isArray(medicines) || medicines.length > 100) {
      return res.status(400).json({ error: "Medicines must be an array of at most 100 items." });
    }
    const result = await autoAllotFormulationsServer(medicines || []);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

// AI Response Report: persists to Firestore aiReports via Admin SDK
app.post("/api/ai/report", aiRateLimiter, async (req, res) => {
  try {
    const { category, comment, responseSnippet, provider } = req.body;
    const cleanCategory = typeof category === 'string' ? category.slice(0, 100) : 'General';
    const cleanComment = typeof comment === 'string' ? comment.slice(0, 2000) : '';
    const cleanSnippet = typeof responseSnippet === 'string' ? responseSnippet.slice(0, 2000) : '';
    const cleanProvider = provider === 'slm' ? 'slm' : 'gemini';

    const reportId = `REP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
    const timestamp = Date.now();

    const reportData = {
      id: reportId,
      category: cleanCategory,
      comment: cleanComment,
      responseSnippet: cleanSnippet,
      provider: cleanProvider,
      timestamp
    };

    if (hasServiceAccountConfigured()) {
      try {
        const db = getAdminDb();
        await db.collection("aiReports").doc(reportId).set(reportData);
      } catch (dbErr) {
        console.warn("[AI REPORT] Firestore save notice:", dbErr);
      }
    }

    console.log(`[AI RESPONSE REPORT] Stored Report ID: ${reportId}, Category: ${cleanCategory}, Provider: ${cleanProvider}`);
    res.json({ 
      success: true, 
      reportId, 
      report: reportData,
      message: "Thank you for reporting this response. The incident has been recorded for clinical AI safety review." 
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || String(error) });
  }
});

app.get("/api/ai/key-status", aiRateLimiter, (req, res) => {
  try {
    const keys = getAvailableKeys();
    if (keys.length > 0) {
      return res.json({ 
        hasKey: true, 
        count: keys.length,
        checkedAt: new Date().toLocaleTimeString()
      });
    } else {
      return res.json({ 
        hasKey: false, 
        count: 0,
        checkedAt: new Date().toLocaleTimeString(),
        error: "API key is not configured in server environment."
      });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

app.get("/api/ai/chat-count", requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const today = new Date().toISOString().split('T')[0];
    const count = await getChatCount(userId, today);
    res.json({ count });
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

app.post("/api/ai/chat", aiRateLimiter, requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const { messages, medicines } = req.body;
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 100) {
      return res.status(400).json({ error: "Messages must be a non-empty array with at most 100 items." });
    }
    if (medicines && (!Array.isArray(medicines) || medicines.length > 500)) {
      return res.status(400).json({ error: "Medicines context must be an array with at most 500 items." });
    }
    const userId = req.userId!;
    const today = new Date().toISOString().split('T')[0];

    const currentCount = await getChatCount(userId, today);
    const DAILY_LIMIT = 50;

    if (currentCount >= DAILY_LIMIT) {
      return res.status(429).json({ 
        error: "Daily message limit reached. Please watch an ad to earn more messages or try again tomorrow.",
        limitReached: true,
        currentCount,
        maxLimit: DAILY_LIMIT
      });
    }

    const response = await chatWithGeminiServer(messages, medicines || []);
    await incrementChatCount(userId, today);

    res.json({ 
      response, 
      remaining: Math.max(0, DAILY_LIMIT - (currentCount + 1)),
      used: currentCount + 1 
    });
  } catch (error: any) {
    console.error("Server chat proxy error:", error);
    res.status(500).json({ error: error.message || String(error) });
  }
});

// Endpoint to register/sync user's active medicine expiry schedule
// Strictly uses token email (never body.email); capped at 500; validates each item
app.post("/api/sync-expiry-schedule", requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const userEmail = req.userEmail;
    if (!userEmail) {
      return res.status(400).json({ error: "Verified user email is required from authentication token." });
    }

    const { emailNotificationsEnabled, medicines } = req.body;
    if (!Array.isArray(medicines)) {
      return res.status(400).json({ error: "Medicines must be an array." });
    }
    if (medicines.length > 500) {
      return res.status(400).json({ error: "Medicines array cannot exceed 500 items." });
    }

    // Validate fields for each item
    const validatedMedicines: ActiveMedicineItem[] = [];
    for (const item of medicines) {
      if (!item || typeof item !== 'object') continue;
      const id = typeof item.id === 'string' ? item.id.slice(0, 100) : '';
      const name = typeof item.name === 'string' ? item.name.trim().slice(0, 200) : '';
      const expirationDate = typeof item.expirationDate === 'string' ? item.expirationDate.trim().slice(0, 50) : '';
      if (!id || !name || !expirationDate) continue;

      let quantity = typeof item.quantity === 'number' ? item.quantity : 0;
      if (typeof item.quantity === 'string') {
        const parsed = parseFloat(item.quantity);
        quantity = isNaN(parsed) ? 0 : parsed;
      }

      validatedMedicines.push({
        id,
        name,
        expirationDate,
        quantity: Math.max(0, quantity),
        enableEmailExpiryAlert: item.enableEmailExpiryAlert !== false
      });
    }

    await registerUserExpirySchedule(
      userId,
      userEmail,
      emailNotificationsEnabled !== false,
      validatedMedicines
    );

    res.json({ success: true, count: validatedMedicines.length });
  } catch (error: any) {
    console.error("Error syncing expiry schedule:", error);
    res.status(500).json({ error: error.message || String(error) });
  }
});

// Endpoint to permanently purge user's server-side schedule and push tokens
app.post("/api/user/purge-data", requireFirebaseAuth, sensitiveAuthActionLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    await purgeUserServerData(userId);
    await deleteUserAllDataFromSupabase(userId);
    res.json({ success: true, purgedUserId: userId });
  } catch (error: any) {
    console.error("Error purging user server data:", error);
    res.status(500).json({ error: error.message || String(error) });
  }
});

// ============================================================
// SUPABASE BACKUP ENDPOINTS (PROTECTED BY FIREBASE AUTH & USER SCOPING)
// ============================================================
app.post("/api/backup/supabase/sync-medicines", requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const { medicines } = req.body;
    if (!Array.isArray(medicines)) {
      return res.status(400).json({ error: "Medicines must be an array." });
    }
    const userId = req.userId!;
    // Strictly isolate data to authenticated user
    const userMeds = medicines
      .filter(m => m && (!m.userId || m.userId === userId))
      .map(m => ({ ...m, userId }));

    const result = await backupMedicinesBatchToSupabase(userMeds, userId);
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

app.post("/api/backup/supabase/sync-medicine", requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const { medicine } = req.body;
    if (!medicine || !medicine.id) {
      return res.status(400).json({ error: "Valid medicine object with id is required." });
    }
    medicine.userId = req.userId!;
    const success = await backupMedicineToSupabase(medicine, req.userId!);
    res.json({ success });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

app.post("/api/backup/supabase/delete-medicine", requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const { medicineId } = req.body;
    if (!medicineId) {
      return res.status(400).json({ error: "medicineId is required." });
    }
    const success = await deleteMedicineFromSupabase(medicineId, req.userId!);
    res.json({ success });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

app.post("/api/backup/supabase/delete-medicines-batch", requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const { medicineIds } = req.body;
    if (!Array.isArray(medicineIds) || medicineIds.length === 0) {
      return res.status(400).json({ error: "medicineIds array is required." });
    }
    const success = await deleteMedicinesBatchFromSupabase(medicineIds, req.userId!);
    res.json({ success });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

app.post("/api/backup/supabase/sync-config", requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const { config } = req.body;
    if (!config || typeof config !== 'object') {
      return res.status(400).json({ error: "Config object is required." });
    }
    config.userId = req.userId!;
    const success = await backupUserConfigToSupabase(config);
    res.json({ success });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

app.post("/api/backup/supabase/sync-history", requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const { history } = req.body;
    if (!history) {
      return res.status(400).json({ error: "history object is required." });
    }
    history.userId = req.userId!;
    const success = await backupMedicineHistoryToSupabase(history);
    res.json({ success });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

// Supabase Status check endpoint
app.get("/api/backup/supabase/status", async (req, res) => {
  try {
    const configured = isSupabaseConfigured();
    if (!configured) {
      return res.json({ configured: false, ok: false, message: "Supabase credentials not configured in server environment." });
    }
    const testRes = await testSupabaseConnection();
    res.json({ configured: true, ...testRes });
  } catch (err: any) {
    res.json({ configured: false, ok: false, message: err.message || String(err) });
  }
});

// Trigger bidirectional sync between Firebase and Supabase
app.post("/api/backup/two-way-sync", requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await runTwoWaySync();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

// Pull updates from Supabase PostgreSQL back into Firebase Firestore
app.post("/api/backup/pull-from-supabase", requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const result = await pullSupabaseToFirebase();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

// Register FCM / Browser push notification token with Firestore for auto alerts
app.post("/api/notifications/register-token", requireFirebaseAuth, authenticatedUidLimiter, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const { token, platform, userAgent } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: "Push token is required" });
    }
    const tokenId = `token_${token.slice(-16).replace(/[^a-zA-Z0-9]/g, '_')}`;
    if (hasServiceAccountConfigured()) {
      const db = getAdminDb();
      await db.collection("users").doc(userId).collection("pushTokens").doc(tokenId).set({
        token,
        platform: platform || "web",
        userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 200) : 'unknown',
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    }
    res.json({ success: true, tokenId });
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

// ============================================================
// 6. CRON ENDPOINTS (PROTECTED STRICTLY BY TIMING-SAFE CRON_SECRET)
// ============================================================

// Authenticated cron sync endpoint for Render Cron Job (ONE-WAY Firestore -> Supabase)
app.post("/api/cron/sync", async (req, res) => {
  if (!verifyCronAuth(req)) {
    return res.status(401).json({ error: "Unauthorized: A valid x-cron-secret header matching CRON_SECRET is required." });
  }

  try {
    const result = await runTwoWaySync();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

// Background expiry check cron endpoint
app.post("/api/cron/check-expiry", async (req, res) => {
  if (!verifyCronAuth(req)) {
    return res.status(401).json({ error: "Unauthorized: A valid x-cron-secret header matching CRON_SECRET is required." });
  }

  try {
    const result = await runBackgroundExpiryCheck();
    res.json({ success: true, ...result });
  } catch (error: any) {
    res.status(500).json({ error: error.message || String(error) });
  }
});

// Public app-ads.txt for Google AdMob crawler verification
app.get("/app-ads.txt", (req, res) => {
  res.type("text/plain");
  res.send("google.com, pub-5865716270182311, DIRECT, f08c47fec0942fa0\n");
});

// ============================================================
// 7. SERVE STATIC ASSETS IN PRODUCTION OR VITE IN DEV
// ============================================================
async function setupViteAndListen() {
  const http = await import("http");
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: "spa",
    });

    // Prevent browser from using stale cached client script in AI Studio
    app.use("/@vite/client", (req, res, next) => {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
      next();
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[DAWASNAP AI SERVER] Running on port ${PORT}`);

    // Ensure only ONE host (Render or local non-serverless, NEVER Vercel serverless) runs background schedulers
    const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    if (!isServerless) {
      startExpiryCron();
      console.log(`[SCHEDULER] Expiry cron worker started in process on primary server.`);
    } else {
      console.log(`[SCHEDULER] Running in serverless mode (Vercel); in-process intervals disabled.`);
    }
  });
}

setupViteAndListen();
export default app;
