import { createHmac, timingSafeEqual } from 'node:crypto';

/** Prefix of member links, so they're never confused with the owner's session token. */
export const MEMBER_TOKEN_PREFIX = 'arm1';

export interface MemberClaims {
  /** Member id. */
  m: string;
  /** Link id: only the member's current link is valid. */
  j: string;
  /** Expiry (ms since epoch). */
  e: number;
}

const mac = (secret: string, payload: string) => createHmac('sha256', secret).update(`${MEMBER_TOKEN_PREFIX}.${payload}`).digest('base64url');

/** `arm1.<claims>.<hmac>`: signed with the host secret; the server still checks the member record. */
export function signMemberToken(secret: string, claims: MemberClaims): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${MEMBER_TOKEN_PREFIX}.${payload}.${mac(secret, payload)}`;
}

/** Claims of a well-formed, correctly signed, unexpired token; otherwise null. */
export function verifyMemberToken(secret: string, token: string | undefined, now = Date.now()): MemberClaims | null {
  if (!token || token.length > 512) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== MEMBER_TOKEN_PREFIX) return null;
  const [, payload, sig] = parts as [string, string, string];
  const expected = Buffer.from(mac(secret, payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let claims: MemberClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as MemberClaims;
  } catch {
    return null;
  }
  if (typeof claims?.m !== 'string' || typeof claims.j !== 'string' || typeof claims.e !== 'number') return null;
  return claims.e > now ? claims : null;
}

export const isMemberToken = (token: string | undefined) => !!token?.startsWith(`${MEMBER_TOKEN_PREFIX}.`);
