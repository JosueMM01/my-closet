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
  hashPasswordResetToken,
  replacePasswordResetToken,
} from '@/server/repositories/password-reset-repository';
import { findUserByEmail, type UserRecord } from '@/server/repositories/users-repository';

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

interface PasswordRecoveryDependencies {
  env?: ServerEnv;
  mailProvider?: MailProvider;
  findUser?: (email: string) => Promise<UserRecord | null>;
  replaceToken?: typeof replacePasswordResetToken;
  generateToken?: () => string;
  now?: () => Date;
}

export async function requestPasswordReset(
  email: string,
  dependencies: PasswordRecoveryDependencies = {},
): Promise<void> {
  const findUser = dependencies.findUser ?? findUserByEmail;
  const user = await findUser(email);
  if (!user || user.status !== 'ACTIVE') return;

  const env = dependencies.env ?? getEnv();
  const provider = dependencies.mailProvider ?? createMailProvider(env);
  const replaceToken = dependencies.replaceToken ?? replacePasswordResetToken;
  const now = dependencies.now?.() ?? new Date();
  const token = dependencies.generateToken?.() ?? randomBytes(32).toString('base64url');
  await replaceToken({
    userId: user.id,
    tokenHash: hashPasswordResetToken(token),
    expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS).toISOString(),
    createdAt: now.toISOString(),
  });

  const message = createPasswordResetEmail({
    email: user.email,
    resetUrl: buildPasswordResetUrl(token, env),
  });
  try {
    await provider.send(message);
  } catch {
    // La respuesta pública es deliberadamente idéntica para evitar enumeración.
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
