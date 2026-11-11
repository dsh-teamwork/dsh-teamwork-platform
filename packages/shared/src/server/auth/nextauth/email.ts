import 'server-only';

import nodemailer from 'nodemailer';

/**
 * Send a sign-in code over SMTP: `SMTP_URL`, such as
 * `smtps://user:password@smtp.example.com:465`. One transport for every
 * deployment — the hosted service points it at Resend's SMTP endpoint, a
 * self-hosted instance at whatever mail server it has.
 *
 * Without SMTP_URL a development server prints the code to its own console so
 * sign-in works on a laptop; anywhere else that is a refusal, because a code
 * logged in production is a code anybody with log access can use.
 */
export async function sendCodeEmail(to: string, code: string): Promise<boolean> {
  const url = process.env.SMTP_URL;
  if (!url) {
    if (process.env.NODE_ENV === 'development') {
      console.info(`[auth] sign-in code for ${to}: ${code} (SMTP_URL unset, not emailed)`);
      return true;
    }
    console.error('[auth] SMTP_URL is not set; no sign-in code can be sent');
    return false;
  }

  try {
    await nodemailer.createTransport(url).sendMail({
      from: process.env.AUTH_EMAIL_FROM ?? 'DSH Teamwork <no-reply@localhost>',
      to,
      subject: `Your sign-in code: ${code}`,
      text: `Your sign-in code is ${code}. It expires in 10 minutes.\n\nIf you did not ask for it, ignore this email.`,
    });
    return true;
  } catch (error) {
    // The server's reply, never the message: it carries the code.
    console.error('[auth] SMTP refused the sign-in code', error instanceof Error ? error.message : error);
    return false;
  }
}
