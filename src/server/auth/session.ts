import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { fail, ok, type Result } from '@/domain/result';
import type { Database } from '../db/client';
import { session, usageQuota, user } from '../db/schema';

/**
 * Konten, Sitzungen und Kontingent.
 *
 * Bewusst eine eigene, schmale Umsetzung statt der vollen Auth.js-Maschinerie:
 * Das Projekt braucht zwei Wege — Zugangsdaten und Gastzugang — und keine
 * Fremdanbieter. Auth.js würde dafür eine Konfigurationsschicht, einen Adapter
 * und ein zweites Sitzungsmodell mitbringen, ohne dass ein Verhalten dazukäme.
 *
 * Was hier trotzdem wie bei Auth.js gelöst ist: Sitzungen liegen in der
 * Datenbank statt in einem selbsttragenden Token, damit sie sich widerrufen
 * lassen.
 */

export const SESSION_COOKIE = 'reiseplaner_session';
const SESSION_DAYS = 30;

/**
 * Argon2id mit bewusst gesetzten Parametern.
 *
 * Die Voreinstellungen der Bibliothek ändern sich zwischen Versionen; für
 * Passwort-Hashes ist das heikel, weil bestehende Hashes weiter prüfbar
 * bleiben müssen. Explizite Werte machen den Kostenfaktor nachvollziehbar.
 */
const ARGON_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export interface SessionUser {
  readonly id: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly isGuest: boolean;
}

export const credentialsSchema = z.object({
  /*
   * Erst normalisieren, dann pruefen. Andersherum scheitert „ Reise@Example.DE "
   * an der Validierung, obwohl die Adresse gueltig ist — Leerzeichen entstehen
   * beim Einfuegen aus der Zwischenablage staendig.
   *
   * Kleinschreibung gehoert ebenfalls hierher: Sonst legt dieselbe Person unter
   * „Reise@" und „reise@" zwei Konten an.
   */
  email: z.string().trim().toLowerCase().pipe(z.email('Bitte eine gültige E-Mail-Adresse angeben')),
  password: z
    .string()
    .min(8, 'Das Passwort braucht mindestens acht Zeichen')
    .max(200, 'Das Passwort ist zu lang'),
});

export type Credentials = z.infer<typeof credentialsSchema>;

function expiryDate(): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + SESSION_DAYS);

  return date;
}

/** Zufälliger, nicht erratbarer Sitzungsschlüssel. */
function createToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface AuthService {
  register(credentials: Credentials): Promise<Result<{ user: SessionUser; token: string }>>;
  login(credentials: Credentials): Promise<Result<{ user: SessionUser; token: string }>>;
  createGuest(): Promise<{ user: SessionUser; token: string }>;
  resolveSession(token: string | undefined): Promise<SessionUser | null>;
  logout(token: string): Promise<void>;
  /** Erhöht den Tageszähler und meldet, ob das Kontingent noch reicht. */
  consumeQuota(userId: string, limit: number): Promise<{ allowed: boolean; used: number }>;
  remainingQuota(userId: string, limit: number): Promise<number>;
}

export function createAuthService(db: Database): AuthService {
  return {
    async register(credentials): Promise<Result<{ user: SessionUser; token: string }>> {
      const parsed = credentialsSchema.safeParse(credentials);

      if (!parsed.success) {
        return fail(
          'validation_error',
          parsed.error.issues[0]?.message ?? 'Die Angaben sind unvollständig',
        );
      }

      const email = parsed.data.email;
      const [vorhanden] = await db.select().from(user).where(eq(user.email, email)).limit(1);

      if (vorhanden !== undefined) {
        return fail('validation_error', 'Zu dieser E-Mail-Adresse besteht bereits ein Konto');
      }

      const passwordHash = await hash(parsed.data.password, ARGON_OPTIONS);

      const [angelegt] = await db
        .insert(user)
        .values({ email, passwordHash, isGuest: false })
        .returning();

      if (angelegt === undefined) {
        return fail('upstream_error', 'Das Konto konnte nicht angelegt werden');
      }

      const token = await startSession(db, angelegt.id);

      return ok({ user: toSessionUser(angelegt), token });
    },

    async login(credentials): Promise<Result<{ user: SessionUser; token: string }>> {
      const parsed = credentialsSchema.safeParse(credentials);

      if (!parsed.success) {
        return fail('validation_error', 'E-Mail oder Passwort stimmen nicht');
      }

      const email = parsed.data.email;
      const [gefunden] = await db.select().from(user).where(eq(user.email, email)).limit(1);

      /*
       * Auch ohne Treffer wird ein Hash geprueft. Sonst antwortet die
       * Anmeldung bei unbekannter Adresse messbar schneller als bei falschem
       * Passwort — und verraet damit, welche Adressen registriert sind.
       */
      const hashToCheck =
        gefunden?.passwordHash ??
        '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$0000000000000000000000000000000000000000000';

      let passt = false;

      try {
        passt = await verify(hashToCheck, parsed.data.password, ARGON_OPTIONS);
      } catch {
        passt = false;
      }

      if (gefunden?.passwordHash == null || !passt) {
        return fail('unauthorized', 'E-Mail oder Passwort stimmen nicht');
      }

      const token = await startSession(db, gefunden.id);

      return ok({ user: toSessionUser(gefunden), token });
    },

    async createGuest(): Promise<{ user: SessionUser; token: string }> {
      const [angelegt] = await db.insert(user).values({ isGuest: true }).returning();

      if (angelegt === undefined) {
        throw new Error('Gastkonto konnte nicht angelegt werden');
      }

      const token = await startSession(db, angelegt.id);

      return { user: toSessionUser(angelegt), token };
    },

    async resolveSession(token): Promise<SessionUser | null> {
      if (token === undefined || token.length === 0) {
        return null;
      }

      const [treffer] = await db
        .select({ user })
        .from(session)
        .innerJoin(user, eq(session.userId, user.id))
        .where(and(eq(session.token, token), gt(session.expiresAt, new Date())))
        .limit(1);

      return treffer === undefined ? null : toSessionUser(treffer.user);
    },

    async logout(token): Promise<void> {
      await db.delete(session).where(eq(session.token, token));
    },

    async consumeQuota(userId, limit): Promise<{ allowed: boolean; used: number }> {
      const heute = new Date().toISOString().slice(0, 10);

      /*
       * Hochzaehlen und Lesen in einer Anweisung: Zwei gleichzeitige
       * Nachrichten duerfen sich nicht denselben Zaehlerstand teilen und so
       * das Kontingent unterlaufen.
       */
      const [zeile] = await db
        .insert(usageQuota)
        .values({ userId, day: heute, messageCount: 1 })
        .onConflictDoUpdate({
          target: [usageQuota.userId, usageQuota.day],
          set: { messageCount: sql`${usageQuota.messageCount} + 1` },
        })
        .returning();

      const used = zeile?.messageCount ?? 1;

      return { allowed: used <= limit, used };
    },

    async remainingQuota(userId, limit): Promise<number> {
      const heute = new Date().toISOString().slice(0, 10);

      const [zeile] = await db
        .select()
        .from(usageQuota)
        .where(and(eq(usageQuota.userId, userId), eq(usageQuota.day, heute)))
        .limit(1);

      return Math.max(0, limit - (zeile?.messageCount ?? 0));
    },
  };
}

async function startSession(db: Database, userId: string): Promise<string> {
  const token = createToken();

  await db.insert(session).values({ token, userId, expiresAt: expiryDate() });

  return token;
}

function toSessionUser(row: {
  id: string;
  email: string | null;
  name: string | null;
  isGuest: boolean;
}): SessionUser {
  return { id: row.id, email: row.email, name: row.name, isGuest: row.isGuest };
}
