import { randomBytes } from 'node:crypto';
import type { cookies } from 'next/headers';
import { z } from 'zod';
import { isProduction } from '@/server/env';
import { safeStateEqual } from './google-flow';
import { deletionDigest } from '@/server/repositories/account-deletion-repository';

export const DELETION_PROOF_COOKIE = 'mc_delete_proof';
export const DELETION_FLOW_COOKIE = 'mc_google_delete_context';
type Store = Awaited<ReturnType<typeof cookies>>;
const contextSchema = z.object({ userId: z.string().min(1), state: z.string().min(32), sessionHash: z.string().length(64), startedAt: z.number().int().positive() }).strict();

export function deletionSessionBinding(cookie: string | undefined): { sessionHash: string; sessionId: string } {
  const sessionId = cookie?.split('.')[0] ?? '';
  return { sessionId, sessionHash: deletionDigest('session', cookie ?? '') };
}

export function signDeletionContext(userId: string, state: string, sessionCookie: string | undefined, startedAt = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ userId, state, sessionHash: deletionSessionBinding(sessionCookie).sessionHash, startedAt })).toString('base64url');
  return `${payload}.${deletionDigest('flow', payload)}`;
}

export function readDeletionContext(value: string | undefined, state: string, sessionCookie: string | undefined) {
  if (!value || value.length > 2048) return null;
  const split = value.lastIndexOf('.');
  const payload = value.slice(0, split);
  if (split < 1 || !safeStateEqual(value.slice(split + 1), deletionDigest('flow', payload))) return null;
  try {
    const parsed = contextSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
    if (!parsed.success || parsed.data.state !== state || parsed.data.sessionHash !== deletionSessionBinding(sessionCookie).sessionHash
      || parsed.data.startedAt > Date.now() + 60_000 || Date.now() - parsed.data.startedAt > 10 * 60_000) return null;
    return parsed.data;
  } catch { return null; }
}

export function freshGoogleDeletionAuthentication(authenticatedAt: number | undefined, startedAt: number, now = Date.now()): boolean {
  if (!authenticatedAt || !Number.isSafeInteger(authenticatedAt)) return false;
  const seconds = now / 1000;
  return authenticatedAt >= Math.floor(startedAt / 1000) - 60 && authenticatedAt >= seconds - 300 && authenticatedAt <= seconds + 60;
}

export function setDeletionFlowCookie(store: Store, context: string): void {
  store.set(DELETION_FLOW_COOKIE, context, { httpOnly: true, secure: isProduction(), sameSite: 'lax', path: '/api/auth/google', maxAge: 600 });
}
export function clearDeletionFlowCookie(store: Store): void {
  store.set(DELETION_FLOW_COOKIE, '', { httpOnly: true, secure: isProduction(), sameSite: 'lax', path: '/api/auth/google', maxAge: 0 });
}
export function newDeletionProof(): string { return randomBytes(32).toString('base64url'); }
export function setDeletionProofCookie(store: Store, value: string): void {
  store.set(DELETION_PROOF_COOKIE, value, { httpOnly: true, secure: isProduction(), sameSite: 'strict', path: '/api/profile/deletion', maxAge: 300 });
}
export function clearDeletionProofCookie(store: Store): void {
  store.set(DELETION_PROOF_COOKIE, '', { httpOnly: true, secure: isProduction(), sameSite: 'strict', path: '/api/profile/deletion', maxAge: 0 });
}
