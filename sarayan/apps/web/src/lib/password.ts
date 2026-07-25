import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing.
 *
 * Separate from `auth.ts` because that module reaches for `cookies()` and
 * `headers()` and is therefore request-scoped; these three functions are pure
 * and are also needed by the seed script, which has no request.
 *
 * scrypt from Node's standard library: no native build step, no dependency to
 * audit, and memory-hard by design.
 */

const scrypt = promisify(scryptCallback);
const SCRYPT_KEYLEN = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password.normalize("NFKC"), salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [algorithm, saltHex, hashHex] = stored.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scrypt(password.normalize("NFKC"), salt, expected.length)) as Buffer;
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 12) return "Use at least 12 characters.";
  if (password.length > 200) return "That password is too long.";
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) {
    return "Include at least one letter and one number.";
  }
  return null;
}
