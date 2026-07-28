'use client';

import { useState, useTransition } from 'react';
import type { FlightOffer, HotelOffer } from '@/domain/offers';
import { runSearch, type SearchResult } from './actions';

/**
 * Schaufenster der Etappe 2.
 *
 * Zweck: das Ergebnis der Adapter von Hand ausprobieren, bevor es in Etappe 5
 * einen echten Chat gibt. Wird mit Etappe 5 entfernt.
 */

function formatEuro(cents: number): string {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

function formatTime(isoTimestamp: string): string {
  return isoTimestamp.slice(11, 16);
}

/**
 * Datum als TT.MM. — ohne Intl, weil dessen Ausgabe von der Systemsprache
 * abhaengt und Server und Browser sich dann widersprechen koennen.
 */
function formatDate(isoTimestamp: string): string {
  return `${isoTimestamp.slice(8, 10)}.${isoTimestamp.slice(5, 7)}.`;
}

function durationLabel(offer: FlightOffer): string {
  const first = offer.outbound[0];
  const last = offer.outbound[offer.outbound.length - 1];

  if (first === undefined || last === undefined) {
    return '';
  }

  const minutes = Math.round((Date.parse(last.arrivalAt) - Date.parse(first.departureAt)) / 60_000);

  return `${String(Math.floor(minutes / 60))} h ${String(minutes % 60).padStart(2, '0')} min`;
}

function FlightCard({ offer }: { offer: FlightOffer }) {
  const outbound = offer.outbound[0];
  const inbound = offer.inbound[0];

  if (outbound === undefined || inbound === undefined) {
    return null;
  }

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium">{outbound.carrier}</span>
        <span className="text-lg font-semibold">{formatEuro(offer.totalPriceCents)}</span>
      </div>

      <dl className="mt-3 grid gap-1 text-sm text-slate-600">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-slate-400">Hinflug</dt>
          <dd>
            <span className="font-medium text-slate-800">{formatDate(outbound.departureAt)}</span>{' '}
            {formatTime(outbound.departureAt)} – {formatTime(outbound.arrivalAt)} ·{' '}
            {outbound.from.iataCode} → {outbound.to.iataCode} · {outbound.flightNumber} ·{' '}
            {durationLabel(offer)}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-slate-400">Rückflug</dt>
          <dd>
            <span className="font-medium text-slate-800">{formatDate(inbound.departureAt)}</span>{' '}
            {formatTime(inbound.departureAt)} – {formatTime(inbound.arrivalAt)} ·{' '}
            {inbound.from.iataCode} → {inbound.to.iataCode} · {inbound.flightNumber}
          </dd>
        </div>
      </dl>
    </li>
  );
}

function HotelCard({ offer }: { offer: HotelOffer }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium">{offer.name}</span>
        <span className="text-lg font-semibold">
          {formatEuro(offer.pricePerNightCents)}
          <span className="text-sm font-normal text-slate-500"> / Nacht</span>
        </span>
      </div>

      <p className="mt-2 text-sm text-slate-600">
        {offer.stars === null ? 'Kategorie unbekannt' : `${String(offer.stars)} Sterne`}
        {offer.distanceToCenterMeters === null
          ? ''
          : ` · ${String(Math.round(offer.distanceToCenterMeters / 100) / 10)} km zum Zentrum`}
      </p>
    </li>
  );
}

export default function DebugSearchPage() {
  const [result, setResult] = useState<SearchResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (formData: FormData) => {
    startTransition(() => {
      void runSearch(formData).then(setResult);
    });
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm font-medium tracking-wide text-brand-600 uppercase">
        Etappe 2 — Schaufenster
      </p>
      <h1 className="mt-2 text-3xl font-semibold">Anbieter-Adapter ausprobieren</h1>
      <p className="mt-2 text-slate-600">
        Diese Seite fragt die Seed-Adapter direkt ab — ohne Agent, ohne Modell, ohne Netzwerk. Alle
        Preise sind erfundene Demo-Werte.
      </p>

      <form action={handleSubmit} className="mt-8 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-slate-600">Von</span>
          <input
            name="origin"
            defaultValue="Düsseldorf"
            required
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600">Nach</span>
          <input
            name="destination"
            defaultValue="Mallorca"
            required
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600">Hinreise</span>
          <input
            type="date"
            name="departureDate"
            defaultValue="2026-09-05"
            required
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600">Rückreise</span>
          <input
            type="date"
            name="returnDate"
            defaultValue="2026-09-12"
            required
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <label className="grid gap-1 text-sm">
          <span className="text-slate-600">Erwachsene</span>
          <input
            type="number"
            name="adults"
            min={1}
            max={9}
            defaultValue={2}
            required
            className="rounded-md border border-slate-300 px-3 py-2"
          />
        </label>

        <div className="flex items-end">
          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-md bg-brand-600 px-4 py-2 font-medium text-white disabled:opacity-60"
          >
            {isPending ? 'Suche läuft …' : 'Suchen'}
          </button>
        </div>
      </form>

      {result !== null && !result.ok ? (
        <p className="mt-8 rounded-md border border-amber-300 bg-amber-50 p-4 text-amber-900">
          {result.message}
        </p>
      ) : null}

      {result?.ok === true ? (
        <div className="mt-10 grid gap-10">
          <p className="text-sm text-slate-500">
            {result.originName} → {result.destinationName}
            {result.weather === undefined
              ? ''
              : ` · im Reisemonat Ø ${String(result.weather.averageHighCelsius)} °C, ${String(result.weather.rainyDays)} Regentage`}
          </p>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Flüge</h2>
            {result.flights === undefined || result.flights.length === 0 ? (
              <p className="text-slate-500">Auf dieser Strecke wurde nichts gefunden.</p>
            ) : (
              <ul className="grid gap-3">
                {result.flights.map((offer) => (
                  <FlightCard key={offer.id} offer={offer} />
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Unterkünfte</h2>
            {result.hotels === undefined || result.hotels.length === 0 ? (
              <p className="text-slate-500">Keine Unterkünfte gefunden.</p>
            ) : (
              <ul className="grid gap-3">
                {result.hotels.map((offer) => (
                  <HotelCard key={offer.id} offer={offer} />
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
