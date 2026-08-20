/**
 * Tipos de dominio compartidos entre cliente (IndexedDB) y servidor (Drizzle).
 * Todas las entidades sincronizables comparten los campos de SyncEntity.
 */

/** Campos comunes de toda entidad sincronizable offline-first. */
export interface SyncEntity {
  /** UUID v4 estable, generado en el cliente. */
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Versión monotónica por entidad: cada escritura incrementa. */
  version: number;
  /** Tombstone para borrado suave replicable. */
  deletedAt: string | null;
  /** Estado de sincronización local del dispositivo. */
  syncStatus: SyncStatus;
}

export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export type Permission = 'VIEW' | 'MANAGE';

export type UserRole = 'USER' | 'ADMIN';

export type UserStatus = 'ACTIVE' | 'DISABLED';

export interface Garment extends SyncEntity {
  userId: string;
  /** Token público para compartir esta prenda sin login. */
  shareableId: string;
  name: string | null;
  category: string;
  colors: string[];
  brand: string | null;
  size: string | null;
  notes: string | null;
  washingInstructions: string | null;
  /** Fecha de adquisición YYYY-MM-DD. */
  dateAcquired: string | null;
  archived: boolean;
  favorite: boolean;
  /** Referencia a la imagen procesada almacenada localmente o en la nube. */
  photoId: string | null;
}

/** Fila del outfit builder: categoría + prenda elegida (o vacía). */
export interface OutfitSlot {
  category: string;
  garmentId: string | null;
}

export interface Outfit extends SyncEntity {
  userId: string;
  shareableId: string;
  name: string | null;
  notes: string | null;
  /** Orden preservado; admite duplicados de categoría. */
  slots: OutfitSlot[];
}

export interface CalendarEntry extends SyncEntity {
  userId: string;
  /** Fecha planificada YYYY-MM-DD. */
  date: string;
  outfitId: string;
  /** Marca de "vestido" cuando el usuario lo confirma. */
  wornAt: string | null;
  notes: string | null;
}

export interface WardrobeShare extends SyncEntity {
  /** Usuario que concede acceso a su armario. */
  grantorId: string;
  granteeId: string | null;
  granteeEmail: string | null;
  permission: Permission;
  inviteToken: string;
  acceptedAt: string | null;
}

/** Perfil mínimo persistido en el dispositivo (sin secretos). */
export interface LocalProfile {
  userId: string;
  email: string;
  displayName: string;
  createdAt: string;
  /** Solo informativo en el cliente; la autorización siempre ocurre en el servidor. */
  role: UserRole;
  profileImageId: string | null;
}

/** Read models privilegiados reemplazados desde las APIs de administración. */
export interface AdminUserCache {
  userId: string;
  email: string;
  displayName: string;
  createdAt: string;
  role: UserRole;
  status: UserStatus;
  profileImageId: string | null;
  adminSlot: 1 | 2 | null;
}

export interface AdminInvitationCache {
  id: string;
  email: string;
  role: UserRole;
  createdBy: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  acceptedBy: string | null;
  createdAt: string;
}

/** Operación registrada en la outbox pendiente de sincronización. */
export type OutboxOperationType = 'upsert' | 'delete';

export type OutboxEntityType = 'garment' | 'outfit' | 'calendarEntry' | 'wardrobeShare';

export interface OutboxOperation {
  operationId: string;
  /** Propietario local que puede sincronizar esta operación. */
  userId: string;
  entityType: OutboxEntityType;
  entityId: string;
  operation: OutboxOperationType;
  /** Snapshot completo de la entidad al momento de encolar. */
  payload: unknown;
  createdAt: string;
  attempts: number;
  status: 'pending' | 'syncing' | 'failed';
  lastError: string | null;
}

/** Registro de imagen procesada en el navegador. */
export interface ImageRecord {
  id: string;
  userId: string;
  mimeType: string;
  /** Nullable para filas históricas creadas antes de sincronizar dimensiones. */
  width: number | null;
  height: number | null;
  byteSize: number;
  createdAt: string;
  updatedAt: string;
  /** Blob WebP persistido en IndexedDB (solo cliente). */
  blob: Blob | null;
  /** URL remota cuando exista almacenamiento en nube. */
  remoteUrl: string | null;
  storageProvider: 'local' | 'cloudinary';
  storageKey: string | null;
  syncStatus: SyncStatus;
}

export interface SyncStats {
  pending: number;
  syncing: number;
  failed: number;
  lastSyncedAt: string | null;
}
