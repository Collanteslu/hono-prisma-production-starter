/**
 * @file mailer.ts
 * @description Pluggable outgoing mail. The transport is chosen with MAIL_TRANSPORT:
 * - `none`   : nothing is sent (default in production until SMTP is configured)
 * - `log`    : the message is printed to the log (development convenience; it contains the token)
 * - `smtp`   : delivered through SMTP_URL with nodemailer
 * - `memory` : kept in `outbox` (tests only)
 */

// Types only: nodemailer itself is loaded lazily, the first time an SMTP message is sent, so
// AUTH_MODE=basic/none (or MAIL_TRANSPORT other than smtp) never load it at runtime
import type { Transporter } from "nodemailer";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Messages captured by the `memory` transport */
export const outbox: MailMessage[] = [];

let smtp: Transporter | undefined;

/** True when messages actually reach people (the flows that depend on email are usable) */
export const mailDelivers = env.MAIL_TRANSPORT === "smtp" || env.MAIL_TRANSPORT === "memory";

/**
 * Sends a message. Never throws: a mail failure must not turn a request into a 500 nor reveal
 * whether an address exists, so errors are logged and reported through the return value.
 */
export async function sendMail(message: MailMessage): Promise<boolean> {
  try {
    switch (env.MAIL_TRANSPORT) {
      case "none":
        logger.warn({ subject: message.subject }, "Mail transport disabled: message not sent");
        return false;
      case "log":
        logger.info({ to: message.to, subject: message.subject, text: message.text }, "📧 Mail");
        return true;
      case "memory":
        outbox.push(message);
        return true;
      case "smtp":
        smtp ??= (await import("nodemailer")).default.createTransport(env.SMTP_URL);
        await smtp.sendMail({ from: env.MAIL_FROM, ...message });
        return true;
    }
  } catch (error) {
    logger.error({ err: error, subject: message.subject }, "Failed to send mail");
    return false;
  }
}
