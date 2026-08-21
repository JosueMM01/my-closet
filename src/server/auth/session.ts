/**
 * Sesiones server-side: token aleatorio en cookie HttpOnly; en la base de
 * datos solo se guarda sha256(token). El token lleva un HMAC con AUTH_SECRET
 * para rechazar valores falsificados sin consultar la base.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { and, eq, gt } from 'drizzle-orm';
import type { UserRole, UserStatus } from '@/lib/domain/types';
import { getAuthSecret, isProduction } from '@/server/env';
import { getServerDB, pgSchema, sqliteSchema } from '@/server/db';

export const SESSION_COOKIE = 'mc_session';
const SESSION_TTL_DAYS = 30;

export interface SessionUser {
  userId: string;
  email: string;
  displayName: string;
  createdAt: string;
  role: UserRole;
  status: UserStatus;
  profileImageId: string | null;
}

export class AuthGuardError extends Error {
  constructor(
    public readonly statusCode: 401 | 403,
    message: string,
  ) {
    super(message);
    this.name = 'AuthGuardError';
  }
}

function hmac(value: string): string {
  return createHmac('sha256', getAuthSecret()).update(value).digest('base64url');
}

function tokenId(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Emite `id.hmac(id)` — el cliente solo ve el token firmado. */
function signToken(id: string): string {
  return `${id}.${hmac(id)}`;
}

function parseToken(cookieValue: string | undefined): string | null {
  if (!cookieValue) return null;
  const dot = cookieValue.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = cookieValue.slice(0, dot);
  const mac = cookieValue.slice(dot + 1);
  if (!safeEqual(mac, hmac(id))) return null;
  return id;
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const id = tokenId(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    await db.postgres.insert(pgSchema.sessions).values({ id, userId, expiresAt });
  } else {
    await db.sqlite
      .insert(sqliteSchema.sessions)
      .values({ id, userId, expiresAt: expiresAt.toISOString() });
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, signToken(id), {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const id = parseToken(store.get(SESSION_COOKIE)?.value);
  if (!id) return null;

  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    const rows = await db.postgres
      .select({
        userId: pgSchema.users.id,
        email: pgSchema.users.email,
        displayName: pgSchema.users.displayName,
        createdAt: pgSchema.users.createdAt,
        role: pgSchema.users.role,
        status: pgSchema.users.status,
        profileImageId: pgSchema.users.profileImageId,
      })
      .from(pgSchema.sessions)
      .innerJoin(pgSchema.users, eq(pgSchema.users.id, pgSchema.sessions.userId))
      .where(
        and(
          eq(pgSchema.sessions.id, id),
          gt(pgSchema.sessions.expiresAt, new Date()),
          eq(pgSchema.users.status, 'ACTIVE'),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? { ...row, createdAt: row.createdAt.toISOString() } : null;
  }
  const rows = await db.sqlite
    .select({
      userId: sqliteSchema.users.id,
      email: sqliteSchema.users.email,
      displayName: sqliteSchema.users.displayName,
      createdAt: sqliteSchema.users.createdAt,
      role: sqliteSchema.users.role,
      status: sqliteSchema.users.status,
      profileImageId: sqliteSchema.users.profileImageId,
    })
    .from(sqliteSchema.sessions)
    .innerJoin(sqliteSchema.users, eq(sqliteSchema.users.id, sqliteSchema.sessions.userId))
    .where(
      and(
        eq(sqliteSchema.sessions.id, id),
        gt(sqliteSchema.sessions.expiresAt, new Date().toISOString()),
        eq(sqliteSchema.users.status, 'ACTIVE'),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthGuardError(401, 'No autenticado o sesión expirada');
  if (user.role !== 'ADMIN') {
    throw new AuthGuardError(403, 'No tienes permisos de administrador');
  }
  return user;
}

/** Revoca todas las sesiones y emite una nueva para mantener utilizable la actual. */
export async function rotateAllSessions(userId: string): Promise<void> {
  const db = await getServerDB();
  if (db.dialect === 'postgres') {
    await db.postgres.delete(pgSchema.sessions).where(eq(pgSchema.sessions.userId, userId));
  } else {
    await db.sqlite.delete(sqliteSchema.sessions).where(eq(sqliteSchema.sessions.userId, userId));
  }
  await createSession(userId);
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const id = parseToken(store.get(SESSION_COOKIE)?.value);
  if (id) {
    const db = await getServerDB();
    if (db.dialect === 'postgres') {
      await db.postgres.delete(pgSchema.sessions).where(eq(pgSchema.sessions.id, id));
    } else {
      await db.sqlite.delete(sqliteSchema.sessions).where(eq(sqliteSchema.sessions.id, id));
    }
  }
  store.delete(SESSION_COOKIE);
}
