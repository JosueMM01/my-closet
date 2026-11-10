import 'server-only';

import { randomBytes } from 'node:crypto';
import { hashPassword } from '@/server/auth/password';
import { getEnv, type ServerEnv } from '@/server/env';
import { createMailProvider, type MailProvider } from '@/server/mail';
import {
  buildPasswordResetUrl,
  createPasswordResetEmail,
} from '@/server/mail/password-reset-email';
import {
  consumePasswordResetToken,
  getPasswordResetTokenState,
  hashPasswordResetToken,
  invalidatePasswordResetToken,
  replacePasswordResetToken,
} from '@/server/repositories/password-reset-repository';
import { findUserByEmail, type UserRecord } from '@/server/repositories/users-repository';

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

interface PasswordRecoveryDependencies {
  env?: ServerEnv;
  mailProvider?: MailProvider;
  findUser?: (email: string) => Promise<UserRecord | null>;
  replaceToken?: typeof replacePasswordResetToken;
  getTokenState?: typeof getPasswordResetTokenState;
  invalidateToken?: typeof invalidatePasswordResetToken;
  generateToken?: () => string;
  now?: () => Date;
  expectedUserId?: string;
  expectedPasswordHash?: string;
}

export async function requestPasswordReset(
  email: string,
  dependencies: PasswordRecoveryDependencies = {},
): Promise<void> {
  const findUser = dependencies.findUser ?? findUserByEmail;
  const user = await findUser(email);
  if (!user || user.status !== 'ACTIVE') return;
  if (dependencies.expectedUserId && (user.id !== dependencies.expectedUserId || user.passwordHash !== dependencies.expectedPasswordHash)) {
    throw new Error('La cuenta cambió durante la solicitud');
  }

  const env = dependencies.env ?? getEnv();
  const provider = dependencies.mailProvider ?? createMailProvider(env);
  const replaceToken = dependencies.replaceToken ?? replacePasswordResetToken;
  const invalidateToken = dependencies.invalidateToken ?? invalidatePasswordResetToken;
  const getTokenState = dependencies.getTokenState ?? getPasswordResetTokenState;
  const now = dependencies.now?.() ?? new Date();
  const token = dependencies.generateToken?.() ?? randomBytes(32).toString('base64url');
  const expectedTokenState = await getTokenState(user.id);
  const tokenHash = hashPasswordResetToken(token);

  // Persist before delivery so every accepted email has a token the app already recognizes.
  await replaceToken({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS).toISOString(),
    createdAt: now.toISOString(),
    expectedEmail: user.email,
    expectedPasswordHash: user.passwordHash,
    expectedTokenState,
  });

  const message = createPasswordResetEmail({
    email: user.email,
    resetUrl: buildPasswordResetUrl(token, env),
  });
  try {
    await provider.send(message);
  } catch {
    try {
      await invalidateToken(tokenHash);
    } catch {
      // A token left active after a failed cleanup remains random and short-lived.
    }
    throw new Error('No se pudo enviar el correo de recuperación');
  }
}

export async function resetPasswordWithToken(token: string, newPassword: string): Promise<boolean> {
  const passwordHash = await hashPassword(newPassword);
  return consumePasswordResetToken({
    tokenHash: hashPasswordResetToken(token),
    passwordHash,
    now: new Date().toISOString(),
  });
}
