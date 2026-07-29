import { formatDate, formatDuration, formatTime } from '@/lib/format';
import type {
  FlightResultOffer,
  HotelResult,
  HotelResultOffer,
  ToolPayload,
  WeatherResult,
} from '@/lib/tool-results';

/**
 * Angebote als Karten.
 *
 * Zeiten stehen immer mit Datum. Das klingt nach einer Kleinigkeit und ist
 * keine: Ein Rueckflug um 09:15 ohne Datum laesst offen, ob er am selben Tag
 * oder eine Woche spaeter geht — bei der Abnahme der Etappe 2 fuehrte genau
 * das zu der Vermutung, die Datumsauswahl sei kaputt.
 */

const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

function euros(value: number): string {
  return `${new Intl.NumberFormat('de-DE').format(value)} €`;
}

/**
 * Woher die Zahl stammt — an jeder Karte.
 *
 * Ohne diese Angabe sieht ein erfundener Preis genauso aus wie ein echter.
 * Das Projekt kommt ohne kostenpflichtige Zugaenge aus und zeigt deshalb
 * teils Beispielwerte; wer das verschweigt, taeuscht.
 */
function SourceHint({ isDemoData, quelle }: { isDemoData: boolean; quelle: string }) {
  return (
    <span
      data-testid="source-hint"
      className={`rounded px-1.5 py-0.5 text-[0.7rem] ${
        isDemoData ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-500'
      }`}
    >
      {isDemoData ? 'Beispieldaten' : `Quelle: ${quelle}`}
    </span>
  );
}

function FlightCard({ offer }: { offer: FlightResultOffer }) {
  const { outboundDeparture, outboundArrival, inboundDeparture } = offer;

  return (
    <li
      data-testid="flight-card"
      className="rounded-lg border border-slate-200 bg-white p-3 text-sm"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{offer.carrier}</span>
        <span className="font-semibold tabular-nums">{euros(offer.priceEuros)}</span>
      </div>

      <dl className="mt-2 grid gap-1 text-slate-600">
        {outboundDeparture !== null && (
          <div className="flex gap-2">
            <dt className="w-14 shrink-0 text-slate-400">Hin</dt>
            <dd className="tabular-nums">
              {formatDate(outboundDeparture)} {formatTime(outboundDeparture)}
              {outboundArrival !== null && (
                <>
                  {' – '}
                  {formatTime(outboundArrival)}
                  <span className="ml-2 text-slate-400">
                    {formatDuration(outboundDeparture, outboundArrival)}
                  </span>
                </>
              )}
            </dd>
          </div>
        )}

        {inboundDeparture !== null && (
          <div className="flex gap-2">
            <dt className="w-14 shrink-0 text-slate-400">Zurück</dt>
            <dd className="tabular-nums">
              {formatDate(inboundDeparture)} {formatTime(inboundDeparture)}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
        <span>{offer.stops === 0 ? 'Direktflug' : `${String(offer.stops)} Zwischenstopp`}</span>
        <SourceHint isDemoData={offer.isDemoData} quelle="Duffel" />
      </div>
    </li>
  );
}

function HotelCard({ offer, nights }: { offer: HotelResultOffer; nights: number }) {
  return (
    <li
      data-testid="hotel-card"
      className="rounded-lg border border-slate-200 bg-white p-3 text-sm"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{offer.name}</span>
        <span className="font-semibold tabular-nums">{euros(offer.totalEuros)}</span>
      </div>

      <p className="mt-1 text-slate-600">
        {euros(offer.pricePerNightEuros)} pro Nacht
        <span className="text-slate-400">
          {' · '}
          {nights === 1 ? '1 Nacht' : `${String(nights)} Nächte`}
        </span>
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        {offer.stars !== null && <span>{'★'.repeat(Math.round(offer.stars))}</span>}
        {offer.distanceToCenterMeters !== null && (
          <span>{formatDistance(offer.distanceToCenterMeters)} zum Zentrum</span>
        )}
        <SourceHint isDemoData={offer.isDemoData} quelle="OpenStreetMap" />
      </div>
    </li>
  );
}

function formatDistance(meters: number): string {
  return meters < 1_000
    ? `${String(Math.round(meters))} m`
    : `${(meters / 1_000).toFixed(1).replace('.', ',')} km`;
}

function WeatherCard({ outlook }: { outlook: WeatherResult }) {
  const month = MONTHS[outlook.month - 1] ?? String(outlook.month);

  return (
    <li
      data-testid="weather-card"
      className="rounded-lg border border-slate-200 bg-white p-3 text-sm"
    >
      <p className="font-medium">Klima im {month}</p>

      <p className="mt-1 text-slate-600 tabular-nums">
        {Math.round(outlook.averageHighCelsius)} °C tagsüber,{' '}
        {Math.round(outlook.averageLowCelsius)} °C nachts
      </p>

      <p className="mt-1 text-xs text-slate-500 tabular-nums">
        {String(outlook.rainyDays)} Regentage
        {outlook.seaTemperatureCelsius !== null && (
          <> · Wasser {Math.round(outlook.seaTemperatureCelsius)} °C</>
        )}
      </p>

      <div className="mt-2 flex items-center gap-2 text-xs">
        <SourceHint isDemoData={outlook.isDemoData === true} quelle="Open-Meteo" />
      </div>
    </li>
  );
}

function HotelList({ result }: { result: HotelResult }) {
  return (
    <>
      {result.offers.map((offer) => (
        <HotelCard key={offer.id} offer={offer} nights={result.nights} />
      ))}
    </>
  );
}

export function OfferCards({ payload }: { payload: ToolPayload }) {
  return (
    <ul className="mt-2 grid gap-2 sm:grid-cols-2">
      {payload.kind === 'flights' &&
        payload.value.offers.map((offer) => <FlightCard key={offer.id} offer={offer} />)}

      {payload.kind === 'hotels' && <HotelList result={payload.value} />}

      {payload.kind === 'weather' && <WeatherCard outlook={payload.value} />}
    </ul>
  );
}
