import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;

export async function hashPassword(raw: string): Promise<string> {
  return bcrypt.hash(raw, BCRYPT_COST);
}

export async function verifyPassword(raw: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(raw, passwordHash);
}

