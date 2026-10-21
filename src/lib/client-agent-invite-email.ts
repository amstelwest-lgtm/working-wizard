/**
 * Invite copy for a firm-sent document link. Rendering only.
 * Nothing in this module sends mail.
 *
 * firstName is a contact given name when the client record has one.
 * clients.name is the business name. Do not pass it, and do not split it.
 * There is no contact first-name column on clients, so callers omit firstName.
 */
import { clientAgentExpiryLabel } from "@/lib/client-agent-link";

export type ClientAgentInviteEmail = {
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** A single given name. A business name, or more than one word, is not used. */
function givenName(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > 40) return null;
  if (!/^[\p{L}][\p{L}'’-]{0,39}$/u.test(trimmed)) return null;
  return trimmed;
}

/** Subject, HTML, and plain text for the document-list invite. */
export function renderClientAgentInviteEmail(input: {
  practiceName: string;
  link: string;
  expiresAt: Date | string;
  firstName?: string | null;
}): ClientAgentInviteEmail {
  const practiceName = clean(input.practiceName) || "Your accountant";
  const link = input.link.trim();
  const expires = clientAgentExpiryLabel(input.expiresAt);
  const name = givenName(input.firstName);
  const greeting = name ? `Hi ${name},` : "Hello,";
  const subject = `${practiceName} asked for a few documents`;
  const safePractice = escapeHtml(practiceName);
  const safeLink = escapeHtml(link);
  const safeExpires = escapeHtml(expires);
  const safeGreeting = escapeHtml(greeting);
  const html = `<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
  <div lang="en" dir="ltr" style="margin:0;padding:24px 16px;background:#ffffff;color:#102A43;font-family:Arial,Helvetica,sans-serif;">
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:#102A43;">${escapeHtml(subject)}</h1>
    <p style="margin:0 0 12px;font-size:16px;line-height:24px;color:#102A43;">${safeGreeting}</p>
    <p style="margin:0 0 12px;font-size:16px;line-height:24px;color:#102A43;">To help with your tax this year, we need a few documents from you.</p>
    <p style="margin:0 0 12px;font-size:16px;line-height:24px;color:#102A43;">This link opens a short list. You'll be asked to agree before anything is stored.</p>
    <p style="margin:0 0 20px;font-size:16px;line-height:24px;color:#102A43;">Only send what you have — skip anything that doesn't apply.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">
      <tr>
        <td align="center" bgcolor="#0B5FFF" style="border-radius:999px;">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeLink}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="50%" stroke="f" fillcolor="#0B5FFF">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">Open your document list</center>
          </v:roundrect>
          <![endif]-->
          <a href="${safeLink}" style="background-color:#0B5FFF;border-radius:999px;color:#ffffff;display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;line-height:48px;text-align:center;text-decoration:none;padding:0 28px;mso-hide:all;">Open your document list</a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 16px;font-size:14px;line-height:22px;color:#3D5270;">Or copy this link:<br><a href="${safeLink}" style="color:#0B5FFF;word-break:break-all;">${safeLink}</a></p>
    <p style="margin:0 0 20px;font-size:14px;line-height:22px;color:#3D5270;">This link expires on ${safeExpires}.</p>
    <p style="margin:0 0 24px;font-size:16px;line-height:24px;color:#102A43;">Kind regards,<br>${safePractice}</p>
    <p style="margin:0;font-size:12px;line-height:18px;color:#3D5270;">Powered by Milōn</p>
  </div>
</body>
</html>`;
  const text = [
    subject,
    "",
    greeting,
    "",
    "To help with your tax this year, we need a few documents from you.",
    "",
    "This link opens a short list. You'll be asked to agree before anything is stored.",
    "",
    "Only send what you have — skip anything that doesn't apply.",
    "",
    `Open your document list: ${link}`,
    "",
    `This link expires on ${expires}.`,
    "",
    "Kind regards,",
    practiceName,
    "",
    "Powered by Milōn",
  ].join("\n");
  return { subject, html, text };
}
