import { Resend } from "resend";
import { getAdminDb, hasServiceAccountConfigured } from "./firebaseAdmin.ts";

export type ExpiryStage = '30_DAYS' | '7_DAYS' | 'EXPIRED';

export function getExpiryEmailSubject(medicineName: string, stage: ExpiryStage = '30_DAYS'): string {
  if (stage === 'EXPIRED') {
    return `Notice: ${medicineName} has Expired - Disposal Advisory`;
  }
  if (stage === '7_DAYS') {
    return `Reminder: ${medicineName} Expires in 7 Days - Refill Required`;
  }
  return `Notice: ${medicineName} Expires in 30 Days`;
}

export function getExpiryEmailHTMLServer(
  medicineName: string, 
  stock: number | string, 
  expiryDate: string,
  stage: ExpiryStage = '30_DAYS'
): string {
  const isExpired = stage === 'EXPIRED';
  const is7Days = stage === '7_DAYS';

  const badgeText = isExpired ? 'EXPIRED' : (is7Days ? 'EXPIRING IN 7 DAYS' : 'EXPIRING IN 30 DAYS');
  const actionText = isExpired ? 'Disposal Required' : (is7Days ? 'Refill Required' : 'Review Stock');
  const statusColor = isExpired ? '#b91c1c' : (is7Days ? '#c2410c' : '#b45309');
  const statusBg = isExpired ? '#fef2f2' : (is7Days ? '#fff7ed' : '#fffbeb');
  const statusBorder = isExpired ? '#fecaca' : (is7Days ? '#fed7aa' : '#fef08a');

  const mainHeader = isExpired 
    ? `Medication Expired: ${medicineName}`
    : (is7Days 
        ? `Refill Reminder: ${medicineName} Expires in 7 Days`
        : `Advance Notice: ${medicineName} Expires in 30 Days`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${mainHeader}</title>
  <style type="text/css">
    body, table, td, p, a, li {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      word-break: break-word;
      -webkit-text-size-adjust: 100%;
    }
    table {
      border-collapse: collapse !important;
      width: 100% !important;
    }
  </style>
</head>
<body style="margin: 0; padding: 20px; background-color: #f8fafc; color: #1e293b;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
    
    <!-- Top Header -->
    <div style="padding: 20px 24px; border-bottom: 1px solid #e2e8f0; background-color: #ffffff;">
      <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">DawaSnap Medication Safety Notice</p>
      <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.3;">${mainHeader}</h1>
    </div>

    <div style="padding: 24px;">
      
      <!-- 1. SUMMARY TABLE AT TOP -->
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background-color: #f1f5f9; border-bottom: 1px solid #e2e8f0;">
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Medicine</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Status</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Expiry Date</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Stock</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 12px; font-size: 13px; font-weight: 700; color: #0f172a; border-bottom: 1px solid #f1f5f9;">${medicineName}</td>
            <td style="padding: 12px; font-size: 11px; border-bottom: 1px solid #f1f5f9;">
              <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: 700; font-size: 10px; background-color: ${statusBg}; color: ${statusColor}; border: 1px solid ${statusBorder};">
                ${badgeText}
              </span>
            </td>
            <td style="padding: 12px; font-size: 13px; font-weight: 600; color: #334155; border-bottom: 1px solid #f1f5f9;">${expiryDate}</td>
            <td style="padding: 12px; font-size: 13px; color: #334155; border-bottom: 1px solid #f1f5f9;">${stock}</td>
            <td style="padding: 12px; font-size: 12px; font-weight: 700; color: ${statusColor}; border-bottom: 1px solid #f1f5f9;">${actionText}</td>
          </tr>
        </tbody>
      </table>

      <!-- 2. DETAILED DESCRIPTION & GOVERNMENT DISPOSAL ADVISORY BELOW TABLE -->
      ${isExpired ? `
      <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px 18px; margin-bottom: 20px;">
        <h2 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 700; color: #991b1b;">Important: Do Not Consume Expired Medication</h2>
        <p style="margin: 0 0 12px 0; font-size: 13px; line-height: 1.6; color: #7f1d1d;">
          This medication reached its official expiration date on <strong>${expiryDate}</strong>. Chemical composition can degrade, reducing efficacy or causing adverse reactions. Please discard this stock immediately.
        </p>

        <h3 style="margin: 12px 0 6px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #991b1b;">
          Safe Disposal Instructions (Government & Municipal Guidelines):
        </h3>
        <ol style="margin: 0; padding-left: 20px; font-size: 12px; line-height: 1.6; color: #7f1d1d;">
          <li style="margin-bottom: 6px;">
            <strong>Discard in Household Dustbin / Dry Waste:</strong> Remove tablets or capsules from their original blister pack or box, mix them with undesirable household material (such as coffee grounds, sawdust, or soil) inside a sealed container or disposable pouch, and place them securely in your household dry waste dustbin. Keep away from children and domestic pets.
          </li>
          <li style="margin-bottom: 6px;">
            <strong>Do Not Flush Down the Toilet or Sink:</strong> Never flush solid or liquid pharmaceuticals down drains or toilets, as compounds pass through water treatment and contaminate municipal water systems and aquatic ecosystems.
          </li>
          <li style="margin-bottom: 0;">
            <strong>Authorized Pharmacy Take-Back:</strong> For liquid syrups, inhalers, or chemotherapy agents, drop off the remaining quantity at a designated pharmacy take-back collection box or government healthcare facility.
          </li>
        </ol>
      </div>
      ` : (is7Days ? `
      <div style="background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 16px 18px; margin-bottom: 20px;">
        <h2 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 700; color: #9a3412;">Refill Action Required (7 Days Remaining)</h2>
        <p style="margin: 0 0 8px 0; font-size: 13px; line-height: 1.6; color: #7c2d12;">
          Your supply of <strong>${medicineName}</strong> will expire on <strong>${expiryDate}</strong>. 
          Please contact your attending doctor or visit your local pharmacy to request a fresh prescription and replenish your supply before this date.
        </p>
        <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #9a3412;">
          Do not save remaining doses beyond the expiration date. Any leftovers after ${expiryDate} must be discarded securely according to standard disposal rules.
        </p>
      </div>
      ` : `
      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 18px; margin-bottom: 20px;">
        <h2 style="margin: 0 0 8px 0; font-size: 14px; font-weight: 700; color: #334155;">Advance Notice (30 Days Remaining)</h2>
        <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #475569;">
          Your current stock of <strong>${medicineName}</strong> is scheduled to expire on <strong>${expiryDate}</strong>. 
          Please check your remaining quantity to determine if you need to schedule a renewal consultation with your doctor.
        </p>
      </div>
      `)}

      <!-- Link to open Vault -->
      <div style="margin: 20px 0; text-align: left;">
        <a href="https://dawasnap.cloud.run" target="_blank" style="display: inline-block; background-color: #0f172a; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 12px; font-weight: 700;">
          View Medicine in Vault
        </a>
      </div>

      <!-- Footer Info -->
      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8; line-height: 1.5;">
        <p style="margin: 0;">This official automated medical advisory was generated by DawaSnap AI based on your inventory tracking schedule.</p>
        <p style="margin: 4px 0 0 0;">DawaSnap AI &bull; Medication Safety &amp; Inventory Management</p>
      </div>

    </div>
  </div>
</body>
</html>`;
}

/**
 * Returns HTML for clean, professional Low Stock/Refill Alert email without emojis.
 */
export function getLowStockEmailHTMLServer(medicineName: string, stock: number | string, threshold: number | string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Refill Required: ${medicineName}</title>
  <style type="text/css">
    body, table, td, p, a {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      word-break: break-word;
    }
    table {
      border-collapse: collapse !important;
      width: 100% !important;
    }
  </style>
</head>
<body style="margin: 0; padding: 20px; background-color: #f8fafc; color: #1e293b;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
    <div style="padding: 20px 24px; border-bottom: 1px solid #e2e8f0;">
      <p style="margin: 0 0 6px 0; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">DawaSnap Inventory Notice</p>
      <h1 style="margin: 0; font-size: 20px; font-weight: 700; color: #0f172a;">Refill Required: ${medicineName}</h1>
    </div>

    <div style="padding: 24px;">
      <!-- TOP SUMMARY TABLE -->
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 0 20px 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <thead>
          <tr style="background-color: #f1f5f9; border-bottom: 1px solid #e2e8f0;">
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Medicine</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Remaining Stock</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Threshold</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 12px; font-size: 13px; font-weight: 700; color: #0f172a;">${medicineName}</td>
            <td style="padding: 12px; font-size: 13px; font-weight: 700; color: #c2410c;">${stock} units</td>
            <td style="padding: 12px; font-size: 13px; color: #64748b;">${threshold} units</td>
            <td style="padding: 12px; font-size: 12px; font-weight: 700; color: #c2410c;">Refill Required</td>
          </tr>
        </tbody>
      </table>

      <!-- INSTRUCTIONS -->
      <div style="background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 14px 16px; margin-bottom: 20px;">
        <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #7c2d12;">
          Your tracked balance for <strong>${medicineName}</strong> has dropped below your minimum threshold (${threshold} units). 
          Please arrange a refill with your healthcare provider or pharmacy to prevent missing daily doses.
        </p>
      </div>

      <div style="margin: 20px 0; text-align: left;">
        <a href="https://dawasnap.cloud.run" target="_blank" style="display: inline-block; background-color: #0f172a; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 12px; font-weight: 700;">
          Update Stock in Vault
        </a>
      </div>

      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8;">
        This automated inventory notification was generated by DawaSnap AI.
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Generates a clean, server-controlled HTML template for notifications without emojis.
 */
export function getGeneralNotificationHTMLServer(subject: string, messageText: string): string {
  const safeSubject = (subject || "DawaSnap Notification").replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });

  const safeMessage = (messageText || "").replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  }).replace(/\n/g, '<br/>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeSubject}</title>
</head>
<body style="margin: 0; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; color: #1e293b;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
    <div style="background-color: #0f172a; padding: 18px 24px; color: #ffffff;">
      <p style="margin: 0 0 4px 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8;">DawaSnap AI</p>
      <h2 style="margin: 0; font-size: 18px; font-weight: 700;">${safeSubject}</h2>
    </div>
    <div style="padding: 24px; font-size: 14px; line-height: 1.6; color: #334155;">
      ${safeMessage}
      <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8;">
        This is an official communication delivered by DawaSnap AI.
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Dispatches an email via Resend directly from the backend server.
 * Uses verified domain alerts@noorpos.in.
 */
export async function sendEmailDirectServer(to: string, subject: string, html: string, text: string) {
  let apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    apiKey = apiKey.trim().replace(/^['"]+|['"]+$/g, '');
  }

  const isKeyInvalid = !apiKey || apiKey === 'YOUR_API_KEY' || apiKey.includes('YOUR_RESEND_API_KEY');
  if (isKeyInvalid) {
    console.log(`[BACKGROUND EXPIRY EMAIL SIMULATED] To: ${to} | Subject: ${subject}`);
    if (hasServiceAccountConfigured()) {
      try {
        const db = getAdminDb();
        await db.collection("mail").add({
          to: to.trim().toLowerCase(),
          message: { subject, html, text },
          delivery: { state: 'SIMULATED', attempts: 1 },
          timestamp: new Date()
        });
      } catch (logErr) {
        console.warn("[MAILBOX LOG ERROR (SIMULATED)]", logErr);
      }
    }
    return { success: true, simulated: true };
  }

  const resend = new Resend(apiKey);
  try {
    const { data, error } = await resend.emails.send({
      from: "DawaSnap AI <alerts@noorpos.in>",
      to: [to],
      subject,
      text,
      html
    });

    if (error) {
      console.warn("[RESEND ERROR]", error);
      return { success: false, error: error.message };
    }

    if (hasServiceAccountConfigured()) {
      try {
        const db = getAdminDb();
        await db.collection("mail").add({
          to: to.trim().toLowerCase(),
          message: { subject, html, text },
          delivery: { state: 'SUCCESS', attempts: 1 },
          timestamp: new Date()
        });
      } catch (logErr) {
        console.warn("[MAILBOX LOG ERROR (SENT)]", logErr);
      }
    }

    return { success: true, id: data?.id };
  } catch (err: any) {
    console.error("[BACKGROUND EMAIL ERROR]", err);
    return { success: false, error: err?.message || String(err) };
  }
}
