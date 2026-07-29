import { z } from 'zod';

/**
 * Was in einem `tool_result`-Block steht — aus Sicht der Oberflaeche.
 *
 * Die Werkzeuge liefern absichtlich eine verkuerzte Fassung der Angebote: Das
 * Modell braucht Preis, Zeiten und Namen, nicht jedes Feld. Diese Schemata
 * beschreiben genau diese verkuerzte Fassung.
 *
 * Sie liegen hier und nicht in der Domaene, weil sie kein Fachbegriff sind,
 * sondern die Nutzlast einer Schnittstelle. Und sie werden geprueft, weil ein
 * gespeicherter Block aus einer aelteren Programmfassung stammen kann — die
 * Datenbank vergisst nicht, wenn sich ein Format aendert.
 */

const flightResultOffer = z.object({
  id: z.string(),
  priceEuros: z.number(),
  carrier: z.string(),
  outboundDeparture: z.string().nullable(),
  outboundArrival: z.string().nullable(),
  inboundDeparture: z.string().nullable(),
  stops: z.number(),
  isDemoData: z.boolean(),
});

export const flightResultSchema = z.object({
  offers: z.array(flightResultOffer),
});

export type FlightResult = z.infer<typeof flightResultSchema>;
export type FlightResultOffer = z.infer<typeof flightResultOffer>;

const hotelResultOffer = z.object({
  id: z.string(),
  name: z.string(),
  stars: z.number().nullable(),
  pricePerNightEuros: z.number(),
  totalEuros: z.number(),
  distanceToCenterMeters: z.number().nullable(),
  isDemoData: z.boolean(),
});

export const hotelResultSchema = z.object({
  nights: z.number(),
  offers: z.array(hotelResultOffer),
});

export type HotelResult = z.infer<typeof hotelResultSchema>;
export type HotelResultOffer = z.infer<typeof hotelResultOffer>;

export const weatherResultSchema = z.object({
  month: z.number(),
  averageHighCelsius: z.number(),
  averageLowCelsius: z.number(),
  rainyDays: z.number(),
  seaTemperatureCelsius: z.number().nullable(),
  // Nachsichtig: Aeltere gespeicherte Ergebnisse kennen das Feld noch nicht.
  isDemoData: z.boolean().optional(),
});

export type WeatherResult = z.infer<typeof weatherResultSchema>;

export type ToolPayload =
  | { readonly kind: 'flights'; readonly value: FlightResult }
  | { readonly kind: 'hotels'; readonly value: HotelResult }
  | { readonly kind: 'weather'; readonly value: WeatherResult };

/**
 * Ordnet einem Werkzeugergebnis seine Darstellung zu.
 *
 * Passt der Inhalt nicht zum erwarteten Format, gibt es `null` und damit keine
 * Karte — die Antwort des Agenten steht ohnehin daneben. Eine kaputte Karte
 * waere schlechter als gar keine.
 */
export function readToolPayload(toolName: string, content: unknown): ToolPayload | null {
  switch (toolName) {
    case 'search_flights': {
      const geprueft = flightResultSchema.safeParse(content);

      return geprueft.success ? { kind: 'flights', value: geprueft.data } : null;
    }

    case 'search_hotels': {
      const geprueft = hotelResultSchema.safeParse(content);

      return geprueft.success ? { kind: 'hotels', value: geprueft.data } : null;
    }

    case 'get_weather_outlook': {
      const geprueft = weatherResultSchema.safeParse(content);

      return geprueft.success ? { kind: 'weather', value: geprueft.data } : null;
    }

    default:
      return null;
  }
}
