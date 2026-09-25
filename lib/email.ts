export type SendEmailResult = { ok: true } | { ok: false; reason: string };

/**
 * The "You're in" email, sent when an admin flips someone from waitlisted to
 * allowed (the database trigger calls /api/webhooks/access-granted, which
 * calls this). Without RESEND_API_KEY the send is logged and skipped so
 * local development needs no credentials; the webhook still answers 200,
 * since the trigger fires exactly once and has no retry to give.
 */
export async function sendAccessGrantedEmail(to: string, fullName: string | null): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email] RESEND_API_KEY not set; skipping "You're in" email to ${to}`);
    return { ok: false, reason: "no_api_key" };
  }

  const from = process.env.EMAIL_FROM || "Foglight <hello@foglight.co>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to,
      subject: "You're in — Foglight",
      html: accessGrantedHtml(to, fullName),
      text: accessGrantedText(to, fullName),
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[email] Resend rejected "You're in" email to ${to}: ${res.status} ${body}`);
    return { ok: false, reason: `resend_${res.status}` };
  }
  return { ok: true };
}

/** Public origin for the sign-in button, or null when SITE_URL is unset. */
function accessUrl(): string | null {
  return process.env.SITE_URL?.replace(/\/+$/, "") || null;
}

function greeting(fullName: string | null): string {
  return fullName ? `Hi ${fullName},` : "Hi,";
}

function accessGrantedText(to: string, fullName: string | null): string {
  const url = accessUrl();
  return [
    greeting(fullName),
    "",
    `You're off the Foglight waitlist. Sign in with ${to} to start building skill packs.`,
    ...(url ? ["", `Open Foglight: ${url}`] : []),
    "",
    "— Foglight",
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function accessGrantedHtml(to: string, fullName: string | null): string {
  const url = accessUrl();
  const button = url
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td bgcolor="#171717">
                      <a href="${escapeHtml(url)}" style="display: inline-block; padding: 12px 28px; font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 500; color: #ffffff; text-decoration: none;">Open Foglight</a>
                    </td>
                  </tr>
                </table>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>You're in — Foglight</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f4f4f2;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f4f4f2;">
      <tr>
        <td align="center" style="padding: 48px 16px;">
          <table role="presentation" width="440" cellpadding="0" cellspacing="0" border="0" style="width: 440px; max-width: 100%; background-color: #ffffff;">
            <tr>
              <td style="padding: 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="background-color: #0b1528; border-radius: 10px; padding: 10px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td width="16" height="16" style="background-color: #0088ff; border-radius: 4px; font-size: 0; line-height: 0;">&nbsp;</td>
                          <td width="5" style="font-size: 0; line-height: 0;">&nbsp;</td>
                          <td width="16" height="16" style="background-color: #55aaff; border-radius: 4px; font-size: 0; line-height: 0;">&nbsp;</td>
                          <td width="5" style="font-size: 0; line-height: 0;">&nbsp;</td>
                          <td width="16" height="16" style="background-color: #b3ddff; border-radius: 4px; font-size: 0; line-height: 0;">&nbsp;</td>
                        </tr>
                        <tr>
                          <td colspan="5" height="5" style="font-size: 0; line-height: 0;">&nbsp;</td>
                        </tr>
                        <tr>
                          <td width="16" height="16" style="background-color: #55aaff; border-radius: 4px; font-size: 0; line-height: 0;">&nbsp;</td>
                          <td width="5" style="font-size: 0; line-height: 0;">&nbsp;</td>
                          <td width="16" height="16" style="background-color: #b3ddff; border-radius: 4px; font-size: 0; line-height: 0;">&nbsp;</td>
                          <td colspan="2" style="font-size: 0; line-height: 0;">&nbsp;</td>
                        </tr>
                        <tr>
                          <td colspan="5" height="5" style="font-size: 0; line-height: 0;">&nbsp;</td>
                        </tr>
                        <tr>
                          <td width="16" height="16" style="background-color: #b3ddff; border-radius: 4px; font-size: 0; line-height: 0;">&nbsp;</td>
                          <td colspan="4" style="font-size: 0; line-height: 0;">&nbsp;</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                <h1 style="margin: 24px 0 8px; font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 22px; font-weight: 600; letter-spacing: -0.02em; color: #171717;">
                  You're in
                </h1>
                <p style="margin: 0 0 24px; font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #555555;">
                  ${escapeHtml(greeting(fullName))} you're off the Foglight waitlist. Sign in with ${escapeHtml(to)} to start building skill packs.
                </p>
                ${button}
                <p style="margin: 24px 0 0; padding-top: 24px; border-top: 1px solid #eeeeee; font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 12px; line-height: 1.6; color: #999999;">
                  You received this because you joined the Foglight waitlist.
                </p>
              </td>
            </tr>
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding-top: 16px; font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 12px; color: #999999;">
                Foglight &middot; foglight.co
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
