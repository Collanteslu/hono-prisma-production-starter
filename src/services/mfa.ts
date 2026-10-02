/**
 * @file mfa.ts
 * @description Second-factor checks shared by login and the MFA management endpoints.
 */

import { prisma } from "../db.js";
import { decryptSecret, hashRecoveryCode, verifyTotp } from "../lib/totp.js";

/**
 * Verifies a TOTP code for a user. A step is accepted at most once: the `totpLastStep` update is
 * a conditional single statement, so two concurrent requests cannot both use the same code.
 */
export async function verifyUserTotp(
  user: { id: string; totpSecret: string | null; totpLastStep: number | null },
  code: string,
): Promise<boolean> {
  if (!user.totpSecret) return false;
  const step = verifyTotp(decryptSecret(user.totpSecret), code, user.totpLastStep);
  if (step === null) return false;
  const claimed = await prisma.user.updateMany({
    where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  });
  return claimed.count === 1;
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
): Promise<boolean> {
  if (factor.code) return verifyUserTotp(user, factor.code);
  if (factor.recoveryCode) return consumeRecoveryCode(user.id, factor.recoveryCode);
  return false;
}
