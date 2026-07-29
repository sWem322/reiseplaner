'use client';

import {
  MISSING_SLOT_ORDER,
  missingSlots,
  type TripDraft,
  type TripSlot,
} from '@/domain/trip/trip';
import { formatDateLong } from '@/lib/format';

/**
 * Der Reise-Entwurf als Leiste.
 *
 * Sie beantwortet die Frage, die ein reiner Chat offen laesst: Was hat der
 * Assistent bisher eigentlich verstanden? Gefuellte Angaben stehen kraeftig,
 * fehlende blass — und zwar in derselben Reihenfolge, in der der Agent
 * nachfragt. Wer die Leiste liest, weiss damit auch, was als Naechstes kommt.
 */

const SLOT_LABELS: Record<TripSlot, string> = {
  destination: 'Ziel',
  origin: 'Abflug',
  departureDate: 'Hinreise',
  returnDate: 'Rückreise',
  adults: 'Erwachsene',
};

interface RowProps {
  readonly label: string;
  readonly value: string | null;
  readonly next?: boolean;
}

function Row({ label, value, next = false }: RowProps) {
  const gefuellt = value !== null;

  return (
    <div
      data-testid={`draft-row-${label}`}
      data-filled={gefuellt}
      className={`flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 ${
        gefuellt ? 'bg-brand-50/60' : next ? 'ring-1 ring-brand-100 ring-inset' : ''
      }`}
    >
      <dt className={`text-xs ${gefuellt ? 'text-brand-700' : 'text-slate-400'}`}>{label}</dt>
      <dd
        className={`text-right text-sm ${gefuellt ? 'font-medium text-slate-800' : 'text-slate-300'}`}
      >
        {value ?? '—'}
      </dd>
    </div>
  );
}

function slotValue(draft: TripDraft, slot: TripSlot): string | null {
  switch (slot) {
    case 'destination':
      return draft.destination === null
        ? null
        : `${draft.destination.name} (${draft.destination.iataCode})`;
    case 'origin':
      return draft.origin === null ? null : `${draft.origin.name} (${draft.origin.iataCode})`;
    case 'departureDate':
      return draft.departureDate === null ? null : formatDateLong(draft.departureDate);
    case 'returnDate':
      return draft.returnDate === null ? null : formatDateLong(draft.returnDate);
    case 'adults':
      return draft.adults === null ? null : String(draft.adults);
  }
}

function childrenLabel(ages: readonly number[]): string | null {
  if (ages.length === 0) {
    return null;
  }

  return ages.map((age) => `${String(age)} J.`).join(', ');
}

export function TripDraftPanel({ draft }: { draft: TripDraft }) {
  const fehlend = missingSlots(draft);
  const naechste = fehlend[0] ?? null;

  return (
    <aside className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Reise-Entwurf">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Reise-Entwurf</h2>
        <span data-testid="draft-progress" className="text-xs text-slate-400 tabular-nums">
          {String(MISSING_SLOT_ORDER.length - fehlend.length)}/{String(MISSING_SLOT_ORDER.length)}
        </span>
      </div>

      <dl className="mt-3 grid gap-1">
        {MISSING_SLOT_ORDER.map((slot) => (
          <Row
            key={slot}
            label={SLOT_LABELS[slot]}
            value={slotValue(draft, slot)}
            next={slot === naechste}
          />
        ))}

        <Row label="Kinder" value={childrenLabel(draft.childAges)} />
        <Row
          label="Budget"
          value={
            draft.budgetEuros === null
              ? null
              : `${new Intl.NumberFormat('de-DE').format(draft.budgetEuros)} €`
          }
        />
      </dl>

      {draft.preferences.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {draft.preferences.map((wunsch) => (
            <li
              key={wunsch}
              className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
            >
              {wunsch}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-slate-500">
        {naechste === null
          ? 'Alle Pflichtangaben liegen vor — die Suche kann laufen.'
          : `Als Nächstes fehlt: ${SLOT_LABELS[naechste]}`}
      </p>
    </aside>
  );
}
