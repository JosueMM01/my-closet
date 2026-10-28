import { createHmac, randomBytes } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getServerDB, type ServerDB } from '@/server/db';
import { getAuthSecret } from '@/server/env';
import { ADMIN_CAPACITY_LOCK } from './admin-capacity';
import { credentialFingerprint } from './email-change-repository';

export class AccountDeletionError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'AccountDeletionError'; }
}

export function deletionDigest(purpose: string, value: string): string {
  return createHmac('sha256', getAuthSecret()).update(JSON.stringify(['account-deletion', purpose, value])).digest('hex');
}

type Workflow<T> = Generator<SQL, T, unknown[]>;
/** Same parameterized SQL/preconditions for both dialects; SQLite callbacks never await. */
async function transact<T>(factory: (postgres: boolean) => Workflow<T>, database?: ServerDB): Promise<T> {
  const db = database ?? await getServerDB();
  if (db.dialect === 'postgres') return db.postgres.transaction(async tx => {
    const flow = factory(true);
    let step = flow.next();
    while (!step.done) step = flow.next(Array.from(await tx.execute(step.value)));
    return step.value;
  });
  return db.sqlite.transaction(tx => {
    const flow = factory(false);
    let step = flow.next();
    while (!step.done) step = flow.next(tx.all<unknown>(step.value));
    return step.value;
  }, { behavior: 'immediate' });
}

const accountRow = z.object({ id: z.string(), email: z.string(), status: z.string(), role: z.string(), password_hash: z.string() });
const proofRow = z.object({ token_hash: z.string(), session_hash: z.string(), credential_hash: z.string(), google_subject: z.string(), expires_at: z.string() });

export async function saveDeletionProof(input: {
  userId: string; token: string; sessionHash: string; credentialHash: string; googleSubject: string;
}, database?: ServerDB): Promise<void> {
  await transact(function* (postgres) {
    const [raw] = yield sql`SELECT id, email, status, role, password_hash FROM users WHERE id=${input.userId} ${postgres ? sql`FOR UPDATE` : sql``}`;
    const user = accountRow.safeParse(raw);
    if (!user.success || user.data.status !== 'ACTIVE' || credentialFingerprint(user.data.password_hash) !== input.credentialHash) {
      throw new AccountDeletionError(401, 'La cuenta cambió. Vuelve a autenticarte.');
    }
    const [linked] = yield sql`SELECT provider_subject FROM auth_accounts WHERE user_id=${input.userId} AND provider='GOOGLE'`;
    if (!linked || z.object({ provider_subject: z.string() }).parse(linked).provider_subject !== input.googleSubject) {
      throw new AccountDeletionError(403, 'Google no corresponde a esta cuenta');
    }
    yield sql`INSERT INTO account_deletion_proofs (user_id, token_hash, session_hash, credential_hash, google_subject, expires_at)
      VALUES (${input.userId}, ${deletionDigest('proof', input.token)}, ${input.sessionHash}, ${input.credentialHash}, ${input.googleSubject}, ${new Date(Date.now() + 5 * 60_000).toISOString()})
      ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash, session_hash=excluded.session_hash,
        credential_hash=excluded.credential_hash, google_subject=excluded.google_subject, expires_at=excluded.expires_at RETURNING user_id`;
  }, database);
}

export async function validDeletionProof(userId: string, token: string | undefined, sessionHash: string, database?: ServerDB): Promise<boolean> {
  if (!token) return false;
  return transact(function* () {
    const [raw] = yield sql`SELECT p.* FROM account_deletion_proofs p JOIN users u ON u.id=p.user_id
      JOIN auth_accounts a ON a.user_id=u.id AND a.provider='GOOGLE' AND a.provider_subject=p.google_subject
      WHERE p.user_id=${userId} AND u.status='ACTIVE'`;
    const proof = proofRow.safeParse(raw);
    if (!proof.success) return false;
    const [account] = yield sql`SELECT id, email, status, role, password_hash FROM users WHERE id=${userId}`;
    const user = accountRow.safeParse(account);
    return user.success && proof.data.expires_at > new Date().toISOString()
      && proof.data.token_hash === deletionDigest('proof', token) && proof.data.session_hash === sessionHash
      && proof.data.credential_hash === credentialFingerprint(user.data.password_hash);
  }, database);
}

export async function deleteOwnAccount(input: {
  userId: string; sessionId: string; credentialHash?: string; googleProof?: string; sessionHash: string;
}, database?: ServerDB): Promise<{ ok: true; cleanupPending: boolean }> {
  const now = new Date().toISOString();
  const unusableCredential = `deleted:${randomBytes(32).toString('hex')}`;
  return transact(function* (postgres) {
    if (postgres) yield sql`SELECT pg_advisory_xact_lock(${ADMIN_CAPACITY_LOCK[0]}, ${ADMIN_CAPACITY_LOCK[1]})`;
    const [raw] = yield sql`SELECT id, email, status, role, password_hash FROM users WHERE id=${input.userId} ${postgres ? sql`FOR UPDATE` : sql``}`;
    const parsed = accountRow.safeParse(raw);
    if (!parsed.success || parsed.data.status !== 'ACTIVE') throw new AccountDeletionError(401, 'La cuenta ya no está activa');
    const user = parsed.data;
    const sessions = yield sql`SELECT id FROM sessions WHERE id=${input.sessionId} AND user_id=${user.id}
      AND expires_at>${now} ${postgres ? sql`FOR UPDATE` : sql``}`;
    if (!sessions.length) throw new AccountDeletionError(401, 'La sesión ya no está vigente');
    const fingerprint = credentialFingerprint(user.password_hash);
    if (input.googleProof) {
      const [rawProof] = yield sql`SELECT * FROM account_deletion_proofs WHERE user_id=${user.id} ${postgres ? sql`FOR UPDATE` : sql``}`;
      const proof = proofRow.safeParse(rawProof);
      const [linked] = yield sql`SELECT provider_subject FROM auth_accounts WHERE user_id=${user.id} AND provider='GOOGLE'`;
      if (!proof.success || proof.data.expires_at <= now || proof.data.session_hash !== input.sessionHash
        || proof.data.token_hash !== deletionDigest('proof', input.googleProof) || proof.data.credential_hash !== fingerprint
        || !linked || z.object({ provider_subject: z.string() }).parse(linked).provider_subject !== proof.data.google_subject) {
        throw new AccountDeletionError(403, 'Vuelve a autenticarte con Google para confirmar la baja');
      }
    } else if (!input.credentialHash || input.credentialHash !== fingerprint) {
      throw new AccountDeletionError(403, 'La contraseña o la cuenta cambió; vuelve a confirmar');
    }
    if (user.role === 'ADMIN') {
      const admins = yield sql`SELECT id FROM users WHERE role='ADMIN' AND status='ACTIVE' ${postgres ? sql`FOR UPDATE` : sql``}`;
      if (admins.length <= 1) throw new AccountDeletionError(409, 'No puedes eliminar al último administrador. Designa otro antes de continuar.');
    }
    // Lock image identities before publishing jobs; reference triggers use the same order.
    if (postgres) yield sql`SELECT id FROM images WHERE user_id=${user.id} ORDER BY id FOR UPDATE`;
    const jobs = yield sql`INSERT INTO image_deletion_jobs (image_id, storage_provider, storage_key, remote_url, state, attempts, next_attempt_at, created_at)
      SELECT id, storage_provider, storage_key, remote_url, 'PENDING', 0, ${now}, ${now} FROM images WHERE user_id=${user.id}
      ON CONFLICT(image_id) DO NOTHING RETURNING image_id`;
    yield sql`DELETE FROM account_invitations WHERE created_by=${user.id} OR accepted_by=${user.id} OR lower(email)=${user.email.toLowerCase()} RETURNING id`;
    yield sql`UPDATE wardrobe_shares SET deleted_at=${now}, updated_at=${now}, server_updated_at=${now}, version=version+1,
      grantee_email=NULL, grantee_id=CASE WHEN grantee_id=${user.id} THEN NULL ELSE grantee_id END,
      invite_token=${randomBytes(32).toString('base64url')} || ':' || id
      WHERE grantor_id=${user.id} OR grantee_id=${user.id} RETURNING id`;
    yield sql`DELETE FROM calendar_entries WHERE user_id=${user.id} RETURNING id`;
    yield sql`DELETE FROM outfits WHERE user_id=${user.id} RETURNING id`;
    yield sql`DELETE FROM garments WHERE user_id=${user.id} RETURNING id`;
    yield sql`DELETE FROM sessions WHERE user_id=${user.id} RETURNING id`;
    yield sql`DELETE FROM password_reset_tokens WHERE user_id=${user.id} RETURNING id`;
    yield sql`DELETE FROM email_change_tokens WHERE user_id=${user.id} RETURNING user_id`;
    yield sql`DELETE FROM auth_accounts WHERE user_id=${user.id} RETURNING id`;
    yield sql`DELETE FROM account_deletion_proofs WHERE user_id=${user.id} RETURNING user_id`;
    // Retain only an opaque disabled principal for referenced images/grant tombstones.
    yield sql`UPDATE users SET email=${`deleted-${randomBytes(24).toString('hex')}@deleted.invalid`}, display_name='Cuenta eliminada',
      password_hash=${unusableCredential}, role='USER', status='DISABLED', admin_slot=NULL, profile_image_id=NULL WHERE id=${user.id} RETURNING id`;
    yield sql`INSERT INTO account_deletions (user_id, deleted_at) VALUES (${user.id}, ${now}) RETURNING user_id`;
    return { ok: true, cleanupPending: jobs.length > 0 };
  }, database);
}

const imageJobRow = z.object({ image_id: z.string(), storage_provider: z.enum(['local', 'cloudinary']), storage_key: z.string().nullable(), remote_url: z.string().nullable(), attempts: z.number().int() });
export type ImageDeletionJob = z.infer<typeof imageJobRow>;

export async function claimImageDeletionJob(imageId: string, database?: ServerDB): Promise<ImageDeletionJob | null> {
  return transact(function* (postgres) {
    if (postgres) yield sql`SELECT id FROM images WHERE id=${imageId} FOR UPDATE`;
    const [raw] = yield sql`SELECT * FROM image_deletion_jobs WHERE image_id=${imageId} AND state IN ('PENDING','PROCESSING','SHARED')
      AND next_attempt_at<=${new Date().toISOString()} ${postgres ? sql`FOR UPDATE` : sql``}`;
    const result = imageJobRow.safeParse(raw);
    if (!result.success) return null;
    const job = result.data;
    const references = yield sql`SELECT id FROM garments WHERE photo_id=${job.image_id}
      UNION ALL SELECT id FROM users WHERE profile_image_id=${job.image_id}
      UNION ALL SELECT i.id FROM images i WHERE i.id<>${job.image_id} AND NOT EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=i.user_id)
        AND ((i.storage_provider=${job.storage_provider} AND i.storage_key=${job.storage_key}) OR (i.remote_url IS NOT NULL AND i.remote_url=${job.remote_url})) LIMIT 1`;
    if (references.length) {
      yield sql`UPDATE image_deletion_jobs SET state='SHARED', next_attempt_at=${new Date(Date.now() + 86_400_000).toISOString()} WHERE image_id=${imageId} RETURNING image_id`;
      return null;
    }
    // A lease prevents two workers claiming the same job; PROCESSING keeps new references blocked on failure.
    yield sql`UPDATE image_deletion_jobs SET state='PROCESSING', attempts=attempts+1,
      next_attempt_at=${new Date(Date.now() + 60_000).toISOString()} WHERE image_id=${imageId} RETURNING image_id`;
    return job;
  }, database);
}

export async function finishImageDeletionJob(imageId: string, database?: ServerDB): Promise<void> {
  await transact(function* (postgres) {
    if (postgres) yield sql`SELECT id FROM images WHERE id=${imageId} FOR UPDATE`;
    const jobs = yield sql`UPDATE image_deletion_jobs SET state='DONE' WHERE image_id=${imageId} AND state='PROCESSING' RETURNING image_id`;
    if (jobs.length) yield sql`DELETE FROM images WHERE id=${imageId} RETURNING id`;
  }, database);
}

export async function dueImageDeletionIds(limit = 10, database?: ServerDB): Promise<string[]> {
  return transact(function* () {
    const rows = yield sql`SELECT image_id FROM image_deletion_jobs WHERE state IN ('PENDING','PROCESSING','SHARED')
      AND next_attempt_at<=${new Date().toISOString()} ORDER BY next_attempt_at LIMIT ${Math.min(Math.max(limit, 1), 25)}`;
    return z.array(z.object({ image_id: z.string() })).parse(rows).map(row => row.image_id);
  }, database);
}

export async function blockImageDeletionJob(imageId: string, database?: ServerDB): Promise<void> {
  await transact(function* () {
    yield sql`UPDATE image_deletion_jobs SET state='BLOCKED' WHERE image_id=${imageId} AND state='PROCESSING' RETURNING image_id`;
  }, database);
}
