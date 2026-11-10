/**
 * @file mfa.ts
 * @description Second-factor checks shared by login and the MFA management endpoints.
 */

import { prisma } from "../db.js";
import { logger } from "../lib/logger.js";
import { decryptSecret, hashRecoveryCode, verifyTotp } from "../lib/totp.js";

export type SecondFactorResult = "ok" | "invalid" | "unreadable";

/**
 * Verifies a TOTP code for a user. A step is accepted at most once: the `totpLastStep` update is
 * a conditional single statement, so two concurrent requests cannot both use the same code.
 *
 * A stored secret that cannot be decrypted (corrupt row or rotated encryption key) is an
 * operational problem, not a wrong code: callers turn "unreadable" into a 503 instead of a 500.
 */
export async function verifyUserTotp(
  user: { id: string; totpSecret: string | null; totpLastStep: number | null },
  code: string,
): Promise<SecondFactorResult> {
  if (!user.totpSecret) return "invalid";

  let step: number | null;
  try {
    step = verifyTotp(decryptSecret(user.totpSecret), code, user.totpLastStep);
  } catch (error) {
    logger.error({ err: error, userId: user.id }, "Stored MFA secret could not be decrypted");
    return "unreadable";
  }
  if (step === null) return "invalid";

  const claimed = await prisma.user.updateMany({
    where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  });
  return claimed.count === 1 ? "ok" : "invalid";
}

/** Consumes a one-time recovery code (atomic: it works once) */
export async function consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
  const claimed = await prisma.recoveryCode.updateMany({
    where: { userId, codeHash: hashRecoveryCode(code), usedAt: null },
    data: { usedAt: new Date() },
  });
  return claimed.count === 1;
}

/** Checks whichever second factor the caller provided */
export async function verifySecondFactor(
  user: { id: string; totpSecret: string | null; totpLastStep: number | null },
  factor: { code?: string; recoveryCode?: string },
): Promise<SecondFactorResult> {
  if (factor.code) return verifyUserTotp(user, factor.code);
  if (factor.recoveryCode) {
    return (await consumeRecoveryCode(user.id, factor.recoveryCode)) ? "ok" : "invalid";
  }
  return "invalid";
}
