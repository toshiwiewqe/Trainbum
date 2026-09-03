/* ==========================================================
   Weather API module
   ----------------------------------------------------------
   Talks to Open-Meteo (free, no API key, CORS-enabled):
     - Geocoding:  https://geocoding-api.open-meteo.com/v1/search
     - Forecast:   https://api.open-meteo.com/v1/forecast

   If you swap in a different weather provider later, you only
   need to rewrite the two functions below that touch the network
   (`geocodeLocation` and `fetchOpenMeteoForecast`) — everything
   that calls this module just awaits `fetchHourlyForecast()` and
   consumes the normalized shape it returns.
   ========================================================== */

const HOURLY_SLOTS = [6, 8, 10, 12, 14, 16, 18, 20, 22]; // 6AM - 10PM, every 2 hours
const FEATURED_HOUR = 14; // 2:00 PM slot is shown as the "current" summary card

const geocodeCache = new Map();

/* ---------- Weather code -> icon/label (WMO codes used by Open-Meteo) ---------- */

function describeWeatherCode(code) {
  const map = {
    0: { icon: "☀️", label: "Clear Sky" },
    1: { icon: "🌤️", label: "Mostly Clear" },
    2: { icon: "⛅", label: "Partly Cloudy" },
    3: { icon: "☁️", label: "Cloudy" },
    45: { icon: "🌫️", label: "Foggy" },
    48: { icon: "🌫️", label: "Foggy" },
    51: { icon: "🌦️", label: "Light Drizzle" },
    53: { icon: "🌦️", label: "Drizzle" },
    55: { icon: "🌦️", label: "Heavy Drizzle" },
    61: { icon: "🌦️", label: "Light Rain" },
    63: { icon: "🌧️", label: "Rain" },
    65: { icon: "🌧️", label: "Heavy Rain" },
    66: { icon: "🌧️", label: "Freezing Rain" },
    67: { icon: "🌧️", label: "Freezing Rain" },
    71: { icon: "🌨️", label: "Light Snow" },
    73: { icon: "🌨️", label: "Snow" },
    75: { icon: "🌨️", label: "Heavy Snow" },
    80: { icon: "🌦️", label: "Rain Showers" },
    81: { icon: "🌧️", label: "Rain Showers" },
    82: { icon: "🌧️", label: "Rain Showers" },
    95: { icon: "⛈️", label: "Thunderstorm" },
    96: { icon: "⛈️", label: "Thunderstorm" },
    99: { icon: "⛈️", label: "Thunderstorm" },
  };
  return map[code] || { icon: "☁️", label: "Cloudy" };
}

/* ---------- Geocoding ---------- */

async function geocodeLocation(locationName) {
  const key = locationName.trim().toLowerCase();
  if (geocodeCache.has(key)) return geocodeCache.get(key);

  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
    locationName,
  )}&count=1&language=en&format=json`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Geocoding request failed");
  const data = await res.json();

  if (!data.results || data.results.length === 0) {
    throw new Error(`No coordinates found for "${locationName}"`);
  }

  const coords = { lat: data.results[0].latitude, lon: data.results[0].longitude };
  geocodeCache.set(key, coords);
  return coords;
}

/* ---------- Forecast ---------- */

async function fetchOpenMeteoForecast({ lat, lon }, dateStr) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=temperature_2m,apparent_temperature,relativehumidity_2m,precipitation_probability,weathercode,windspeed_10m` +
    `&start_date=${dateStr}&end_date=${dateStr}&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) throw new Error("Forecast request failed");
  const data = await res.json();

  if (!data.hourly || !data.hourly.time || data.hourly.time.length === 0) {
    throw new Error("No forecast data available for that date");
  }
  return data.hourly;
}

/* ---------- Fallback (used if the date is out of the API's range, the
   location can't be geocoded, or the network call fails) so the UI
   always has something sensible to show. Deterministic per date so it
   doesn't jump around on re-render. ---------- */

function generateFallbackForecast(dateStr) {
  let seed = 0;
  for (const ch of dateStr) seed = (seed * 31 + ch.charCodeAt(0)) % 1000;
  const rand = (min, max) => min + ((seed = (seed * 9301 + 49297) % 233280) / 233280) * (max - min);

  const codes = [1, 2, 3, 61, 80, 63];
  return HOURLY_SLOTS.map((hour) => {
    const code = codes[Math.floor(rand(0, codes.length))];
    const temp = Math.round(rand(13, 19));
    return {
      hour,
      tempC: temp,
      feelsLikeC: temp - Math.round(rand(1, 4)),
      humidity: Math.round(rand(75, 95)),
      precipProbability: Math.round(rand(20, 90)),
      windKph: Math.round(rand(6, 12)),
      ...describeWeatherCode(code),
    };
  });
}

/* ---------- Public API ---------- */

/**
 * Fetch the every-2-hours forecast (6AM–10PM) for a specific hike date
 * and trail location.
 *
 * @param {string} dateStr        "YYYY-MM-DD"
 * @param {string} locationName   e.g. "Benguet, Philippines"
 * @returns {Promise<{
 *   slots: Array<{hour:number, timeLabel:string, tempC:number, feelsLikeC:number,
 *                 humidity:number, precipProbability:number, windKph:number,
 *                 icon:string, label:string}>,
 *   featured: (same shape as a slot entry),
 *   isFallback: boolean
 * }>}
 */
export async function fetchHourlyForecast(dateStr, locationName) {
  let hourly = null;
  let isFallback = false;

  try {
    const coords = await geocodeLocation(locationName);
    hourly = await fetchOpenMeteoForecast(coords, dateStr);
  } catch (err) {
    console.warn("Weather API fallback engaged:", err.message);
    isFallback = true;
  }

  let slots;

  if (hourly) {
    slots = HOURLY_SLOTS.map((hour) => {
      const idx = hourly.time.findIndex((t) => new Date(t).getHours() === hour);
      const weatherCode = idx !== -1 ? hourly.weathercode[idx] : 3;
      return {
        hour,
        tempC: idx !== -1 ? Math.round(hourly.temperature_2m[idx]) : null,
        feelsLikeC: idx !== -1 ? Math.round(hourly.apparent_temperature[idx]) : null,
        humidity: idx !== -1 ? Math.round(hourly.relativehumidity_2m[idx]) : null,
        precipProbability: idx !== -1 ? Math.round(hourly.precipitation_probability[idx]) : null,
        windKph: idx !== -1 ? Math.round(hourly.windspeed_10m[idx]) : null,
        ...describeWeatherCode(weatherCode),
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
  const featured = withLabels.find((s) => s.hour === FEATURED_HOUR) || withLabels[0];

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