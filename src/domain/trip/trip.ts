import { z } from 'zod';
import { fail, ok, type Result } from '../result';

/**
 * Domaenenmodell der Reiseplanung.
 *
 * Zentrale Unterscheidung:
 * - TripDraft ist der Zustand waehrend des Dialogs. Jedes Feld darf fehlen.
 * - TripQuery ist die fertige Suchanfrage. Nichts darf fehlen.
 *
 * Der Agent arbeitet immer auf dem Entwurf und darf erst suchen, wenn dieser
 * sich verlustfrei in eine Anfrage ueberfuehren laesst.
 */

// --- Bausteine ---------------------------------------------------------

/*
 * Fehlermeldungen der Schemata sind Text, den sowohl das Sprachmodell als auch
 * die reisende Person zu lesen bekommt — sie stehen deshalb in korrektem
 * Deutsch mit Umlauten. Nur Kommentare und Bezeichner im Code verzichten
 * darauf (siehe AGENTS.md).
 */
export const iataCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'IATA-Code besteht aus genau drei Großbuchstaben');

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT erwartet')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Kein gültiges Datum');

export const placeSchema = z.object({
  name: z.string().min(1, 'Ortsname darf nicht leer sein'),
  iataCode: iataCodeSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export type Place = z.infer<typeof placeSchema>;

const adultsSchema = z
  .number()
  .int('Anzahl Erwachsener muss ganzzahlig sein')
  .min(1, 'Mindestens eine erwachsene Person')
  .max(9, 'Höchstens neun erwachsene Personen');

const childAgeSchema = z
  .number()
  .int('Alter muss ganzzahlig sein')
  .min(0, 'Alter darf nicht negativ sein')
  .max(17, 'Ab 18 Jahren zählt eine Person als erwachsen');

const budgetSchema = z
  .number()
  .int('Budget in ganzen Euro angeben')
  .positive('Budget muss größer als null sein');

// --- Status ------------------------------------------------------------

export const TRIP_DRAFT_STATUS = ['collecting', 'searching', 'proposed', 'confirmed'] as const;

export const tripDraftStatusSchema = z.enum(TRIP_DRAFT_STATUS);

export type TripDraftStatus = z.infer<typeof tripDraftStatusSchema>;

// --- Entwurf -----------------------------------------------------------

/**
 * Pflichtangaben in der Reihenfolge, in der der Agent nachfragen soll.
 * Erst das Ziel, dann der Zeitraum, dann die Reisenden — so wuerde auch ein
 * Mensch am Schalter fragen.
 */
export const MISSING_SLOT_ORDER = [
  'destination',
  'origin',
  'departureDate',
  'returnDate',
  'adults',
] as const;

export type TripSlot = (typeof MISSING_SLOT_ORDER)[number];

export const REQUIRED_SLOTS: readonly TripSlot[] = MISSING_SLOT_ORDER;

const MAX_TRIP_DURATION_DAYS = 365;

const tripDraftShape = z.object({
  origin: placeSchema.nullable(),
  destination: placeSchema.nullable(),
  departureDate: isoDateSchema.nullable(),
  returnDate: isoDateSchema.nullable(),
  adults: adultsSchema.nullable(),
  childAges: z.array(childAgeSchema).max(9, 'Höchstens neun Kinder'),
  budgetEuros: budgetSchema.nullable(),
  preferences: z.array(z.string().min(1)).max(20),
  status: tripDraftStatusSchema,
});

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return (end - start) / 86_400_000;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const tripDraftSchema = tripDraftShape
  .refine(
    (draft) =>
      draft.departureDate === null || draft.returnDate === null
        ? true
        : daysBetween(draft.departureDate, draft.returnDate) >= 0,
    { message: 'Rückreise darf nicht vor der Hinreise liegen', path: ['returnDate'] },
  )
  .refine((draft) => draft.departureDate === null || draft.departureDate >= todayIso(), {
    message: 'Abflugdatum darf nicht in der Vergangenheit liegen',
    path: ['departureDate'],
  })
  .refine(
    (draft) =>
      draft.departureDate === null || draft.returnDate === null
        ? true
        : daysBetween(draft.departureDate, draft.returnDate) <= MAX_TRIP_DURATION_DAYS,
    { message: 'Reisedauer von über einem Jahr wird nicht unterstützt', path: ['returnDate'] },
  )
  .refine(
    (draft) =>
      draft.origin === null || draft.destination === null
        ? true
        : draft.origin.iataCode !== draft.destination.iataCode,
    { message: 'Abflug- und Zielort müssen sich unterscheiden', path: ['destination'] },
  );

export type TripDraft = z.infer<typeof tripDraftShape>;

export function emptyTripDraft(): TripDraft {
  return {
    origin: null,
    destination: null,
    departureDate: null,
    returnDate: null,
    adults: null,
    childAges: [],
    budgetEuros: null,
    preferences: [],
    status: 'collecting',
  };
}

/**
 * Welche Pflichtangaben fehlen noch?
 *
 * Die Reihenfolge ist bewusst stabil: Der Agent stellt genau eine Rueckfrage,
 * naemlich zum ersten Eintrag. Eine wechselnde Reihenfolge wuerde denselben
 * Dialog bei gleicher Eingabe unterschiedlich verlaufen lassen und die
 * Eval-Ergebnisse verrauschen.
 */
export function missingSlots(draft: TripDraft): TripSlot[] {
  return MISSING_SLOT_ORDER.filter((slot) => draft[slot] === null);
}

export function canStartSearch(draft: TripDraft): boolean {
  return missingSlots(draft).length === 0;
}

// --- Suchanfrage -------------------------------------------------------

export const tripQuerySchema = z.object({
  origin: placeSchema,
  destination: placeSchema,
  departureDate: isoDateSchema,
  returnDate: isoDateSchema,
  adults: adultsSchema,
  childAges: z.array(childAgeSchema),
  budgetEuros: budgetSchema.nullable(),
  preferences: z.array(z.string().min(1)),
});

export type TripQuery = z.infer<typeof tripQuerySchema>;

/**
 * Ueberfuehrt einen Entwurf in eine Suchanfrage.
 *
 * Gibt bewusst ein Result zurueck statt zu werfen: Der Aufruf kommt aus dem
 * Agenten-Loop, und ein unvollstaendiger Entwurf ist dort kein Programmfehler,
 * sondern eine erwartete Zwischenstufe, auf die das Modell reagieren soll.
 */
export function toTripQuery(draft: TripDraft): Result<TripQuery> {
  const missing = missingSlots(draft);

  if (missing.length > 0) {
    return fail('validation_error', `Es fehlen noch Angaben: ${missing.join(', ')}`, {
      missing,
    });
  }

  const parsed = tripQuerySchema.safeParse({
    origin: draft.origin,
    destination: draft.destination,
    departureDate: draft.departureDate,
    returnDate: draft.returnDate,
    adults: draft.adults,
    childAges: draft.childAges,
    budgetEuros: draft.budgetEuros,
    preferences: draft.preferences,
  });

  if (!parsed.success) {
    return fail('validation_error', 'Der Entwurf ergibt keine gueltige Suchanfrage', {
      issues: parsed.error.issues,
    });
  }

  return ok(parsed.data);
}
