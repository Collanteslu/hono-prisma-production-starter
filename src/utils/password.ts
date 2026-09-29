/**
 * @file password.ts
 * @description Cryptographic password hashing and verification utility using bcryptjs.
 */

import bcrypt from "bcryptjs";

/** Number of salt rounds for key derivation */
const SALT_ROUNDS = 10;

/**
 * Hashes a plaintext password using bcrypt with an automatically generated salt.
 * @param plainPassword Raw password entered by the user
 * @returns Resolves to the secure bcrypt hash string
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * Compares a plaintext password against a stored bcrypt hash in constant time
 * to prevent timing-attack vulnerabilities.
 * @param plainPassword Raw password candidate
 * @param hash Stored bcrypt hash from the database
 * @returns True if password matches hash, false otherwise
 */
export async function comparePassword(plainPassword: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, hash);
}
