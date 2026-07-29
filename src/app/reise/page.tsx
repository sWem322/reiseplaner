import { redirect } from 'next/navigation';
import Link from 'next/link';
import { currentUser, serverApi } from '@/server/trpc/server-caller';
import { NewTripButton } from '@/components/trip-list-actions';
import { formatDateLong } from '@/lib/format';

/**
 * Vergangene Reisen.
 *
 * Der Titel entsteht beim ersten erkannten Ziel — ein Dialog ohne Ziel heisst
 * deshalb noch nicht „Mallorca", sondern traegt sein Datum.
 */

export default async function TripListPage() {
  const user = await currentUser();

  if (user === null) {
    redirect('/');
  }

  const api = await serverApi();
  const reisen = await api.conversation.list();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Deine Reisen</h1>
          <p className="mt-1 text-sm text-slate-500">
            {reisen.length === 0
              ? 'Noch nichts geplant.'
              : `${String(reisen.length)} ${reisen.length === 1 ? 'Gespräch' : 'Gespräche'}`}
          </p>
        </div>

        <NewTripButton />
      </header>

      {reisen.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
          Leg eine Reise an und schreib einfach los — zum Beispiel „Eine Woche Mallorca im
          September, zu zweit“.
        </p>
      ) : (
        <ul className="grid gap-2">
          {reisen.map((reise) => (
            <li key={reise.id}>
              <Link
                href={`/reise/${reise.id}`}
                data-testid="trip-link"
                className="hover:border-brand-500 flex items-baseline justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3"
              >
                <span className="font-medium">
                  {reise.title ?? `Gespräch vom ${formatDateLong(isoDay(reise.createdAt))}`}
                </span>

                <span className="text-xs text-slate-400 tabular-nums">
                  {formatDateLong(isoDay(reise.updatedAt))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/** Tagesanteil eines Zeitstempels, unabhaengig von der Zeitzone der Anzeige. */
function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}
