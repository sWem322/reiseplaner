import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ContextModule from './context';
import type { AppContext } from './context';

/**
 * Geprueft wird genau eine Sache: dass das Sitzungscookie aus der Anfrage im
 * Kontext ankommt.
 *
 * Das klingt banal, ist aber die Stelle, an der eine Server-Komponente
 * unbemerkt abgemeldet arbeiten wuerde — sie bekaeme dann `null` als Person
 * und zeigte eine leere Liste statt der Reisen. Ein Fehler, der wie
 * „keine Daten" aussieht und nicht wie ein Fehler.
 */

const cookieStore = { value: undefined as string | undefined };

vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        cookieStore.value === undefined || name !== 'reiseplaner_session'
          ? undefined
          : { name, value: cookieStore.value },
    }),
}));

vi.mock('@/server/db/client', () => ({ db: {} }));

const erhalteneKopfzeilen: Headers[] = [];

vi.mock('./context', async (original) => {
  const echt = await original<typeof ContextModule>();

  return {
    ...echt,
    createContext: (input: { headers: Headers }) => {
      erhalteneKopfzeilen.push(input.headers);

      return Promise.resolve({ user: null } as unknown as AppContext);
    },
  };
});

const { currentUser } = await import('./server-caller');

describe('Kontext aus dem Cookie', () => {
  beforeEach(() => {
    erhalteneKopfzeilen.length = 0;
    cookieStore.value = undefined;
  });

  it('reicht das Sitzungscookie an den Kontext weiter', async () => {
    cookieStore.value = 'abc123';

    await currentUser();

    expect(erhalteneKopfzeilen[0]?.get('cookie')).toBe('reiseplaner_session=abc123');
  });

  it('kodiert einen Wert mit Sonderzeichen', async () => {
    cookieStore.value = 'a+b/c=';

    await currentUser();

    expect(erhalteneKopfzeilen[0]?.get('cookie')).toBe('reiseplaner_session=a%2Bb%2Fc%3D');
  });

  it('sendet ohne Sitzung gar kein Cookie', async () => {
    await currentUser();

    expect(erhalteneKopfzeilen[0]?.get('cookie')).toBeNull();
  });

  it('meldet ohne Sitzung niemanden als angemeldet', async () => {
    await expect(currentUser()).resolves.toBeNull();
  });
});
