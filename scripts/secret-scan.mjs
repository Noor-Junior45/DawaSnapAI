#!/usr/bin/env node
/**
 * Pre-commit Secret & Credential Scanner
 * Validates that no sensitive files or credentials are committed.
 */
import fs from 'fs';
import path from 'path';

const FORBIDDEN_EXTENSIONS = ['.keystore', '.jks', '.p12', '.key', '.pem'];
const SENSITIVE_PATTERNS = [
  /-----BEGIN\s+(RSA|EC|DSA|OPENSSH|PGP)?\s*PRIVATE KEY-----/,
  /"private_key":\s*"-----BEGIN PRIVATE KEY/,
  /sk_live_[0-9a-zA-Z]{24}/, // Live payment processor keys
  /re_[0-9a-zA-Z]{24}/, // Live Resend API key
];

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.gradle', 'build', '.aistudio']);
const ALLOWED_CLIENT_CONFIGS = new Set([
  '.env.example', 
  'keystore.properties.example', 
  'firebase-applet-config.json',
  'google-services.json'
]);

let violationCount = 0;

// Verify .gitignore actively ignores sensitive secrets
const gitignorePath = path.join(process.cwd(), '.gitignore');
if (fs.existsSync(gitignorePath)) {
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  const requiredPatterns = ['.env*', '*.keystore', '*.jks', '*.key', '*.pem'];
  for (const pat of requiredPatterns) {
    if (!gitignoreContent.includes(pat)) {
      console.error(`[SECRET SCAN ERROR] .gitignore is missing critical ignore rule for: ${pat}`);
      violationCount++;
    }
  }
} else {
  console.error('[SECRET SCAN ERROR] .gitignore file is missing in repository root.');
  violationCount++;
}

function scanDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(process.cwd(), fullPath);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        scanDir(fullPath);
      }
      continue;
    }

    if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const baseName = entry.name;

      // Skip files explicitly in allowed client config list
      if (ALLOWED_CLIENT_CONFIGS.has(baseName)) {
        continue;
      }

      // Check forbidden keystore or private key extensions
      if (FORBIDDEN_EXTENSIONS.includes(ext)) {
        console.error(`[SECRET SCAN ERROR] Forbidden certificate or key file detected: ${relPath}`);
        violationCount++;
        continue;
      }

      // 3. Check file contents for private keys and leaked tokens
      if (
        !ALLOWED_CLIENT_CONFIGS.has(baseName) &&
        !relPath.endsWith('.map') &&
        !relPath.endsWith('.lock') &&
        !relPath.endsWith('package-lock.json') &&
        !relPath.endsWith('secret-scan.mjs')
      ) {
        try {
          const stats = fs.statSync(fullPath);
          if (stats.size < 1024 * 1024) { // Only scan text files < 1MB
            const content = fs.readFileSync(fullPath, 'utf8');
            for (const pattern of SENSITIVE_PATTERNS) {
              if (pattern.test(content)) {
                // Ignore placeholder/example values
                if (
                  !content.includes('YOUR_API_KEY') &&
                  !content.includes('MY_GEMINI_API_KEY') &&
                  !content.includes('YOUR_RESEND_API_KEY')
                ) {
                  console.error(`[SECRET SCAN ERROR] Potential sensitive secret pattern matched in: ${relPath}`);
                  violationCount++;
                  break;
                }
              }
            }
          }
        } catch {
          // Binary file or read error, ignore
        }
      }
    }
  }
}

console.log('🔒 Starting pre-commit security & secret scan...');
scanDir(process.cwd());

if (violationCount > 0) {
  console.error(`❌ Security Scan Failed: Found ${violationCount} forbidden file(s) or exposed secret(s).`);
  console.error('Please remove sensitive files and ensure .gitignore properly excludes secrets.');
  process.exit(1);
} else {
  console.log('✅ Security Scan Passed: Zero leaked secrets, keystores, or forbidden credentials found.');
  process.exit(0);
}
