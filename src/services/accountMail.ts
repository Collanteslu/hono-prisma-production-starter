/**
 * @file accountMail.ts
 * @description Emails sent by the account flows. Sending is fire-and-forget on purpose: the
 * HTTP response must not depend on (or reveal through its latency) whether an address exists.
 */

import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { sendMail } from "../lib/mailer.js";
import { createAuthToken } from "./authTokens.js";

interface Recipient {
  id: string;
  name: string;
  email: string;
}

const minutes = (n: number) => n * 60_000;

/** Runs a task in the background, logging (never throwing) its failures */
export function inBackground(task: () => Promise<unknown>): void {
  void task().catch((error) => logger.error({ err: error }, "Background account task failed"));
}

export async function sendVerificationEmail(user: Recipient): Promise<void> {
  const token = await createAuthToken(
    user,
    "email_verify",
    env.EMAIL_VERIFY_TTL_HOURS * 60 * minutes(1),
  );
  await sendMail({
    to: user.email,
    subject: "Verify your email address",
    text: `Hi ${user.name},\n\nConfirm your email address by opening:\n${env.APP_URL}/verify-email?token=${token}\n\nThe link is valid for ${env.EMAIL_VERIFY_TTL_HOURS} hours. If you did not create this account, ignore this message.`,
  });
}

/**
 * Tells the address the account had BEFORE a change that the email moved. It carries no token, so an
 * abandoned or bounced mailbox cannot lock anyone out. Without it, an attacker who changes the email
 * keeps the real owner completely in the dark.
 */
export async function sendEmailChangedNotice(recipient: {
  name: string;
  email: string;
}): Promise<void> {
  await sendMail({
    to: recipient.email,
    subject: "Your account email was changed",
    text: `Hi ${recipient.name},\n\nThe email address on your account was changed. If you did not do it, sign in and choose a new password right away, or ask support to lock the account.`,
  });
}

export async function sendPasswordResetEmail(user: Recipient): Promise<void> {
  const token = await createAuthToken(
    user,
    "password_reset",
    minutes(env.PASSWORD_RESET_TTL_MINUTES),
  );
  await sendMail({
    to: user.email,
    subject: "Reset your password",
    text: `Hi ${user.name},\n\nSomeone asked to reset your password. To choose a new one, open:\n${env.APP_URL}/reset-password?token=${token}\n\nThe link is valid for ${env.PASSWORD_RESET_TTL_MINUTES} minutes and works once. If it was not you, ignore this message: your password stays the same.`,
  });
}
