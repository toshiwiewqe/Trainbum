/* ==========================================================
   Weather API module — WeatherAPI.com
   ----------------------------------------------------------
   Single endpoint does geocoding + forecast + real observed
   "current conditions" in one call:
     https://api.weatherapi.com/v1/forecast.json

   Free tier: 1M calls/month, no card required.
   Get a key at https://www.weatherapi.com/ → paste below.

   Why this replaced Open-Meteo: Open-Meteo is pure forecast-
   model output with no live observations, so during active/
   patchy weather (e.g. an ongoing monsoon system) it can miss
   what's actually happening right now. WeatherAPI's `current`
   field is a real observed/nowcast reading, which is what
   Google's "right now" panel is built on too — so featured-slot
   accuracy for "today" is much closer.
   ========================================================== */

const WEATHERAPI_KEY = "YOUR_API_KEY_HERE"; // <-- paste your WeatherAPI.com key

const HOURLY_SLOTS = [6, 8, 10, 12, 14, 16, 18, 20, 22]; // 6AM - 10PM, every 2 hours
const PH_TIMEZONE = "Asia/Manila"; // used to pick the "featured" (highlighted) slot

/* ---------- Condition text -> icon/label/condition category
   WeatherAPI returns a `condition.text` string (e.g. "Patchy rain
   possible", "Partly cloudy") and a numeric `condition.code`. We
   keep the same emoji-based shape the rest of the app expects,
   matched by keyword so we don't have to hardcode all ~50 codes.
   `condition` (lowercase key) is a coarse category used elsewhere
   for background selection. ---------- */

function describeCondition(text) {
  const t = (text || "").toLowerCase();

  if (t.includes("thunder") || t.includes("storm")) {
    return { icon: "⛈️", label: text, condition: "storm" };
  }
  if (t.includes("snow") || t.includes("sleet") || t.includes("ice") || t.includes("blizzard")) {
    return { icon: "🌨️", label: text, condition: "snow" };
  }
  if (t.includes("fog") || t.includes("mist") || t.includes("haze")) {
    return { icon: "🌫️", label: text, condition: "fog" };
  }
  if (t.includes("rain") || t.includes("drizzle") || t.includes("shower")) {
    return { icon: "🌧️", label: text, condition: "rain" };
  }
  if (t.includes("overcast") || t.includes("cloudy")) {
    return { icon: "☁️", label: text, condition: "cloudy" };
  }
  if (t.includes("partly")) {
    return { icon: "⛅", label: text, condition: "cloudy" };
  }
  if (t.includes("sunny") || t.includes("clear")) {
    return { icon: "☀️", label: text, condition: "sunny" };
  }
  return { icon: "☁️", label: text || "Cloudy", condition: "cloudy" };
}

/* ---------- Forecast / current fetch ----------
   `q` accepts "lat,lon" or a place name string — WeatherAPI
   geocodes place names internally, so no separate geocoding call
   is needed (unlike the old Open-Meteo setup). `dt` requests a
   specific date; free tier supports today + a few days ahead. */

async function fetchWeatherApiForecast(q, dateStr) {
  const url =
    `https://api.weatherapi.com/v1/forecast.json?key=${WEATHERAPI_KEY}` +
    `&q=${encodeURIComponent(q)}&days=1&dt=${dateStr}&aqi=no&alerts=no`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message || "Forecast request failed");
  }
  const data = await res.json();

  if (!data.forecast || !data.forecast.forecastday || data.forecast.forecastday.length === 0) {
    throw new Error("No forecast data available for that date");
  }
  return data;
}

/* ---------- Fallback (used if the date is out of range, the
   location can't be resolved, or the network call fails) so the
   UI always has something sensible to show. Deterministic per
   date so it doesn't jump around on re-render. ---------- */

function generateFallbackForecast(dateStr) {
  let seed = 0;
  for (const ch of dateStr) seed = (seed * 31 + ch.charCodeAt(0)) % 1000;
  const rand = (min, max) => min + ((seed = (seed * 9301 + 49297) % 233280) / 233280) * (max - min);

  const labels = ["Partly cloudy", "Cloudy", "Light rain", "Patchy rain possible", "Overcast", "Sunny"];
  return HOURLY_SLOTS.map((hour) => {
    const label = labels[Math.floor(rand(0, labels.length))];
    const temp = Math.round(rand(13, 19));
    return {
      hour,
      tempC: temp,
      feelsLikeC: temp - Math.round(rand(1, 4)),
      humidity: Math.round(rand(75, 95)),
      precipProbability: Math.round(rand(20, 90)),
      windKph: Math.round(rand(6, 12)),
      ...describeCondition(label),
    };
  });
}

/* ---------- Featured-slot selection ----------
   The "featured" card is the one highlighted in the hourly strip
   (the green-bordered one). It tracks the current time in the
   Philippines and highlights whichever HOURLY_SLOTS entry is
   closest to "right now". ---------- */

function getCurrentPhHour() {
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: PH_TIMEZONE,
    hour: "numeric",
    hour12: false,
  }).format(new Date());
  const hour = parseInt(hourStr, 10);
  return hour === 24 ? 0 : hour;
}

function getCurrentPhDateStr() {
  // "YYYY-MM-DD" for "today" in Philippine time, for comparing against
  // the picked booking date to decide whether to use live `current` data.
  return new Intl.DateTimeFormat("en-CA", { timeZone: PH_TIMEZONE }).format(new Date());
}

function pickFeaturedHour() {
  const currentHour = getCurrentPhHour();
  return HOURLY_SLOTS.reduce((closest, hour) => {
    const currentDist = Math.abs(closest - currentHour);
    const newDist = Math.abs(hour - currentHour);
    // On an exact tie (e.g. 3PM sitting midway between the 2PM and 4PM
    // slots), prefer the later slot — the current hour has already
    // started moving into that block.
    return newDist <= currentDist ? hour : closest;
  });
}

/* ---------- Public API ---------- */

/**
 * Fetch the every-2-hours forecast (6AM–10PM) for a specific hike date.
 *
 * @param {string} dateStr           "YYYY-MM-DD"
 * @param {string} locationName      e.g. "Nasugbu, Batangas" — used as the
 *                                    `q` query ONLY when coordsOverride
 *                                    isn't given, and for the fallback seed.
 * @param {{lat:number, lon:number}} [coordsOverride] — pass exact trail
 *                                    coordinates (e.g. from Firestore) for
 *                                    precise location targeting (important
 *                                    for mountains/peaks vs. their nearest
 *                                    town).
 * @returns {Promise<{
 *   slots: Array<{hour:number, timeLabel:string, tempC:number, feelsLikeC:number,
 *                 humidity:number, precipProbability:number, windKph:number,
 *                 icon:string, label:string, condition:string}>,
 *   featured: (same shape as a slot entry),
 *   isFallback: boolean
 * }>}
 */
export async function fetchHourlyForecast(dateStr, locationName, coordsOverride = null) {
  let data = null;
  let isFallback = false;

  const q = coordsOverride ? `${coordsOverride.lat},${coordsOverride.lon}` : locationName;

  try {
    data = await fetchWeatherApiForecast(q, dateStr);
  } catch (err) {
    console.warn("Weather API fallback engaged:", err.message);
    isFallback = true;
  }

  let slots;

  if (data) {
    const hourly = data.forecast.forecastday[0].hour; // 24 entries for the requested date
    slots = HOURLY_SLOTS.map((hour) => {
      const entry = hourly.find((h) => new Date(h.time).getHours() === hour);
      if (!entry) {
        return { hour, tempC: null, feelsLikeC: null, humidity: null, precipProbability: null, windKph: null, ...describeCondition("") };
      }
      return {
        hour,
        tempC: Math.round(entry.temp_c),
        feelsLikeC: Math.round(entry.feelslike_c),
        humidity: Math.round(entry.humidity),
        precipProbability: Math.round(entry.chance_of_rain ?? 0),
        windKph: Math.round(entry.wind_kph),
        ...describeCondition(entry.condition?.text),
      };
    });
  } else {
    slots = generateFallbackForecast(dateStr);
  }

  const formatHour = (h) => {
    const period = h >= 12 ? "PM" : "AM";
    const display = h % 12 === 0 ? 12 : h % 12;
    return `${display}:00 ${period}`;
  };

  const withLabels = slots.map((s) => ({ ...s, timeLabel: formatHour(s.hour) }));
  const featuredHour = pickFeaturedHour();
  let featured = withLabels.find((s) => s.hour === featuredHour) || withLabels[0];

  // If the booked date is today (PH time) and the live call succeeded,
  // swap in WeatherAPI's real observed `current` reading for the
  // featured card instead of the nearest forecasted hourly slot — this
  // is the piece that actually matches what Google shows as "right now".
  if (data && dateStr === getCurrentPhDateStr() && data.current) {
    const c = data.current;
    featured = {
      ...featured,
      tempC: Math.round(c.temp_c),
      feelsLikeC: Math.round(c.feelslike_c),
      humidity: Math.round(c.humidity),
      windKph: Math.round(c.wind_kph),
      ...describeCondition(c.condition?.text),
    };
  }

  return { slots: withLabels, featured, isFallback };
}

/**
 * Builds a short, human-readable hiker's tip from the day's forecast.
 */
export function buildHikerTip(slots) {
  const maxRain = Math.max(...slots.map((s) => s.precipProbability ?? 0));
  const minTemp = Math.min(...slots.map((s) => s.tempC ?? 99));

  if (maxRain >= 60) {
    return "Rain likely today. Pack waterproof gear, keep dry layers handy, and stay safe on the trail.";
  }
  if (minTemp <= 12) {
    return "Cold conditions expected. Bring extra layers and a warm jacket.";
  }
  if (maxRain >= 30) {
    return "A chance of showers — a light rain jacket is a good idea.";
  }
  return "Good conditions for your hike! Bring water, sun protection, and comfortable footwear.";
}

export function buildAlertMessage(slots, isFallback) {
  const maxRain = Math.max(...slots.map((s) => s.precipProbability ?? 0));
  const minTemp = Math.min(...slots.map((s) => s.tempC ?? 99));
  const prefix = isFallback ? "(Estimated) " : "";

  if (maxRain >= 60 && minTemp <= 15) {
    return `${prefix}Expect cold and wet conditions. Bring waterproof gear and extra layers.`;
  }
  if (maxRain >= 60) {
    return `${prefix}Expect wet conditions. Bring waterproof gear.`;
  }
  if (minTemp <= 12) {
    return `${prefix}Expect cold conditions. Bring extra layers.`;
  }
  return `${prefix}Conditions look good for your hike.`;
}