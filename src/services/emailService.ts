import { db, getAuthHeader } from '../firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { getApiUrl, getDirectBackendUrl } from '../utils/apiConfig';

export interface EmailParams {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Synchronizes user's active medicines with the backend server.
 * The backend cron runs 24/7 in the background and sends emails strictly ONCE
 * per medicine stage when the app is closed, preventing multi-device duplicate emails.
 */
export async function syncExpiryScheduleWithServer(
  userId: string,
  email: string,
  emailNotificationsEnabled: boolean,
  medicines: Array<{
    id: string;
    name: string;
    expirationDate?: string;
    quantity?: number;
    enableEmailExpiryAlert?: boolean;
    isDeleted?: boolean;
    taken?: boolean;
  }>
): Promise<void> {
  if (!userId || !email) return;

  const activeMeds = medicines
    .filter(m => !m.isDeleted && !m.taken && m.expirationDate)
    .slice(0, 500)
    .map(m => ({
      id: m.id,
      name: String(m.name || '').slice(0, 200),
      expirationDate: String(m.expirationDate!).slice(0, 50),
      quantity: typeof m.quantity === 'number' ? Math.max(0, m.quantity) : 1,
      enableEmailExpiryAlert: m.enableEmailExpiryAlert !== false
    }));

  const payload = JSON.stringify({
    userId,
    email,
    emailNotificationsEnabled,
    medicines: activeMeds
  });

  try {
    const authHeaders = await getAuthHeader();
    let res: Response | null = null;
    try {
      res = await fetch(getApiUrl('/api/sync-expiry-schedule'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: payload
      });
    } catch (e) {}

    if (!res || !res.ok || res.status === 404) {
      try {
        await fetch(getDirectBackendUrl('/api/sync-expiry-schedule'), {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            ...authHeaders
          },
          body: payload
        });
      } catch (err) {}
    }
  } catch (e) {
    console.warn('[EMAIL SERVICE] Expiry schedule sync skipped:', e);
  }
}

/**
 * Dispatches an email alert using the backend SMTP nodemailer server route
 * and records a copy of the message in the Firestore 'mail' collection to populate the mailbox history.
 */
export async function sendEmailAlert(params: EmailParams): Promise<{ success: boolean; simulated?: boolean; message?: string }> {
  try {
    const authHeaders = await getAuthHeader();
    // 1. Call our custom Express email API (proxied or direct Cloud Run backend)
    let response: Response | null = null;
    try {
      response = await fetch(getApiUrl('/api/send-email'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify(params)
      });
    } catch (e) {}

    if (!response || !response.ok || response.status === 404) {
      try {
        response = await fetch(getDirectBackendUrl('/api/send-email'), {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            ...authHeaders
          },
          body: JSON.stringify(params)
        });
      } catch (e) {}
    }
    
    if (response.ok) {
      const data = await response.json();
      
      // Save copy in Firestore 'mail' collection so the mailbox inbox history updates in real-time
      try {
        await addDoc(collection(db, 'mail'), {
          to: params.to,
          message: {
            subject: (params.subject || 'DawaSnap Notification').slice(0, 190),
            text: (params.text || '').slice(0, 19000),
            html: (params.html || '<p></p>').slice(0, 19000)
          },
          timestamp: serverTimestamp()
        });
      } catch (firestoreErr) {
        console.warn('[EMAIL SERVICE] Optional Firestore backup copy skipped:', firestoreErr);
      }
      
      return data;
    } else {
      const errText = await response.text();
      throw new Error(errText || 'SMTP server returned an error');
    }
  } catch (error: any) {
    console.warn('[EMAIL SERVICE] SMTP API failed, attempting direct Firestore collection write fallback:', error);
    
    // 2. Direct Firestore fallback in case the backend is unreachable or building
    try {
      await addDoc(collection(db, 'mail'), {
        to: params.to,
        message: {
          subject: params.subject,
          text: params.text,
          html: params.html
        },
        timestamp: serverTimestamp()
      });
      return { success: true, message: "Dispatched to Firestore collection" };
    } catch (fallbackError: any) {
      console.error('[EMAIL SERVICE] Firestore fallback also failed:', fallbackError);
      throw new Error(`Email transmission failed: ${error.message || error}`);
    }
  }
}

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

/**
 * Returns HTML for professional Expiry Alert email without emojis,
 * placing summary table at the top and government disposal instructions below.
 */
export function getExpiryEmailHTML(
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
    @media only screen and (max-width: 600px) {
      .med-wrapper { padding: 12px 6px !important; }
      .med-card { padding: 18px 14px !important; }
      .med-th, .med-td { padding: 8px 6px !important; font-size: 11px !important; }
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
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 0 24px 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; width: 100%;">
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
          This medication reached its official expiration date on <strong>${expiryDate}</strong>. Chemical composition degrades over time, reducing potency and potentially forming toxic breakdown compounds. Discontinue use immediately.
        </p>

        <h3 style="margin: 12px 0 6px 0; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #991b1b;">
          Safe Disposal Instructions (Government &amp; Municipal Guidelines):
        </h3>
        <ol style="margin: 0; padding-left: 20px; font-size: 12px; line-height: 1.6; color: #7f1d1d;">
          <li style="margin-bottom: 6px;">
            <strong>Discard in Household Dustbin / Dry Waste:</strong> Remove tablets or capsules from their packaging, mix them with undesirable household material (such as coffee grounds, sawdust, or soil) inside a sealed container or disposable pouch, and place them securely in your household dry waste dustbin. Keep strictly away from children and domestic pets.
          </li>
          <li style="margin-bottom: 6px;">
            <strong>Do Not Flush Down the Toilet or Sink:</strong> Never flush medications down drains or toilets to prevent contaminating municipal water systems and aquatic ecosystems.
          </li>
          <li style="margin-bottom: 0;">
            <strong>Authorized Pharmacy Take-Back:</strong> For liquid syrups, inhalers, or chemotherapy agents, drop off remaining quantity at a designated pharmacy take-back collection box or government healthcare facility.
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
          Do not save remaining doses beyond the expiration date. Any leftovers after ${expiryDate} must be discarded securely according to standard government disposal rules.
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
        <a href="https://dawalens.cloud.run" target="_blank" style="display: inline-block; background-color: #0f172a; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 12px; font-weight: 700;">
          Open DawaSnap Vault
        </a>
      </div>

      <!-- Footer Info -->
      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8; line-height: 1.5;">
        <p style="margin: 0;">This automated medication advisory was generated by DawaSnap AI based on your inventory tracking schedule.</p>
        <p style="margin: 4px 0 0 0;">DawaSnap AI &bull; Medication Safety &amp; Inventory Management</p>
      </div>

    </div>
  </div>
</body>
</html>`;
}

/**
 * Returns HTML for clean, professional Low Stock/Refill Alert email without emojis,
 * with table at top and refill instructions below.
 */
export function getLowStockEmailHTML(medicineName: string, stock: number | string, threshold: number | string): string {
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
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 0 20px 0; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; width: 100%;">
        <thead>
          <tr style="background-color: #f1f5f9; border-bottom: 1px solid #e2e8f0;">
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Medicine</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Remaining Stock</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Threshold</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Status</th>
            <th style="padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase;">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 12px; font-size: 13px; font-weight: 700; color: #0f172a;">${medicineName}</td>
            <td style="padding: 12px; font-size: 13px; font-weight: 700; color: #c2410c;">${stock} units</td>
            <td style="padding: 12px; font-size: 13px; color: #64748b;">${threshold} units</td>
            <td style="padding: 12px; font-size: 12px; font-weight: 700; color: #c2410c;">Low Stock</td>
            <td style="padding: 12px; font-size: 12px; font-weight: 700; color: #c2410c;">Refill Required</td>
          </tr>
        </tbody>
      </table>

      <!-- INSTRUCTIONS BELOW TABLE -->
      <div style="background-color: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 14px 16px; margin-bottom: 20px;">
        <h2 style="margin: 0 0 6px 0; font-size: 13px; font-weight: 700; color: #9a3412;">Refill Action Required</h2>
        <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #7c2d12;">
          Your tracked balance for <strong>${medicineName}</strong> has dropped below your minimum threshold (${threshold} units). 
          Please arrange a refill with your healthcare provider or pharmacy to prevent missing daily doses.
        </p>
      </div>

      <div style="margin: 20px 0; text-align: left;">
        <a href="https://dawalens.cloud.run" target="_blank" style="display: inline-block; background-color: #0f172a; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 12px; font-weight: 700;">
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
 * Returns HTML for beautiful Consultation Report email matching user screenshot
 */
export function getConsultationReportEmailHTML(medicinesList: { name: string; dosage?: string }[], chatHistoryHtml: string, dateStr: string): string {
  const medRows = medicinesList.length > 0 
    ? medicinesList.map(m => `
        <tr style="background-color: #ffffff;">
          <td style="padding: 10px 16px; font-size: 14px; color: #1f2937; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">${m.name}</td>
          <td style="padding: 10px 16px; font-size: 14px; color: #4b5563; border-bottom: 1px solid #e5e7eb;">${m.dosage || 'N/A'}</td>
        </tr>
      `).join('')
    : `
        <tr style="background-color: #ffffff;">
          <td colspan="2" style="padding: 12px 16px; font-size: 14px; color: #6b7280; text-align: center; border-bottom: 1px solid #e5e7eb;">No medicines currently listed in active inventory.</td>
        </tr>
      `;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
  <title>Consultation Report: DawaSnap AI</title>
  <style type="text/css">
    body, table, td, p, a, li, blockquote {
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    table, td {
      mso-table-lspace: 0pt;
      mso-table-rspace: 0pt;
    }
    table {
      border-collapse: collapse !important;
    }
    body {
      height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      background-color: #f2f5f8;
    }
    @media only screen and (max-width: 600px) {
      .email-wrapper {
        padding: 12px 6px !important;
        width: 100% !important;
      }
      .email-card-cell {
        padding: 22px 14px !important;
        border-radius: 12px !important;
      }
      .email-header {
        font-size: 18px !important;
        line-height: 1.35 !important;
      }
      .med-table {
        width: 100% !important;
      }
      .med-th, .med-td {
        padding: 10px 8px !important;
        font-size: 12px !important;
      }
      .btn-action {
        display: block !important;
        width: 100% !important;
        text-align: center !important;
        box-sizing: border-box !important;
        padding: 13px 16px !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f2f5f8; width: 100% !important;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#f2f5f8" style="background-color: #f2f5f8; width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" class="email-wrapper" style="padding: 32px 14px;">
        
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 620px; width: 100%; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.03); overflow: hidden;">
          <tr>
            <td class="email-card-cell" style="padding: 34px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; box-sizing: border-box;">
              
              <!-- Badge -->
              <div style="margin-bottom: 12px;">
                <span style="background-color: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; padding: 4px 12px; border-radius: 9999px; font-size: 11px; font-weight: 700; letter-spacing: 0.05em; display: inline-block;">
                  CLINICAL REPORT SUMMARY
                </span>
              </div>

              <!-- Header -->
              <h2 class="email-header" style="color: #0f9d58; font-size: 21px; font-weight: 800; margin: 0 0 16px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.35;">
                Consultation Report: DawaSnap AI
              </h2>
              
              <p style="color: #374151; font-size: 15px; margin: 0 0 10px 0; line-height: 1.6;">Hello,</p>
              <p style="color: #374151; font-size: 15px; margin: 0 0 20px 0; line-height: 1.6;">
                Here is your digital health consultation summary and medical report generated on <strong>${dateStr}</strong>.
              </p>

              <!-- Current Medications Header -->
              <h3 style="color: #1f2937; font-size: 15px; font-weight: 700; margin: 20px 0 10px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                Current Medications In Vault
              </h3>
              
              <!-- Medications Table -->
              <div style="width: 100%; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 24px; background-color: #ffffff; box-sizing: border-box;">
                <table class="med-table" border="0" cellpadding="0" cellspacing="0" width="100%" style="width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0;">
                  <thead>
                    <tr style="background-color: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                      <th class="med-th" style="padding: 12px 14px; text-align: left; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; border-right: 1px solid #e2e8f0; width: 60%; word-break: break-word;">Medicine Name</th>
                      <th class="med-th" style="padding: 12px 14px; text-align: left; font-size: 12px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; width: 40%; word-break: break-word;">Strength / Dosage</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${medRows}
                  </tbody>
                </table>
              </div>

              <!-- Chat History/Summary -->
              <h3 style="color: #1f2937; font-size: 15px; font-weight: 700; margin: 0 0 10px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                Consultation Conversation Log
              </h3>
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; margin-bottom: 24px; max-height: 400px; overflow-y: auto; font-size: 14px; line-height: 1.6; color: #374151; word-wrap: break-word; overflow-wrap: break-word; box-sizing: border-box;">
                ${chatHistoryHtml}
              </div>
              
              <!-- Disclaimer -->
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 14px 16px; border-radius: 8px; margin: 20px 0; color: #78350f; font-size: 13px; line-height: 1.5; box-sizing: border-box; word-break: break-word;">
                <strong>Disclaimer:</strong> This consultation report was generated by AI for digital bookkeeping and self-tracking. It is purely informational and not a substitute for professional medical diagnosis, treatment, or advice. Please discuss any medicinal routine with your primary care physician.
              </div>

              <!-- Action Button -->
              <div style="margin: 26px 0 20px 0; text-align: left;">
                <a href="https://dawasnap.vercel.app" target="_blank" class="btn-action" style="background-color: #0f9d58; color: #ffffff; text-decoration: none; padding: 13px 26px; border-radius: 8px; font-weight: 700; font-size: 14px; display: inline-block; box-shadow: 0 2px 4px rgba(15,157,88,0.2); box-sizing: border-box; text-align: center;">Open App Dashboard</a>
              </div>
              
              <!-- Footer Info -->
              <p style="color: #94a3b8; font-size: 12px; margin: 24px 0 0 0; line-height: 1.5; border-top: 1px solid #f1f5f9; padding-top: 16px;">
                This is an automated report message from <strong>DawaSnap AI</strong>. You can view your full history in your DawaSnap Vault.
              </p>

            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}
