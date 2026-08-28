/* -----------------------------------------------------------------------------
 * weather.js — conditions at each yacht, from Open-Meteo.
 *
 * No API key, no account, no cost. Two endpoints per yacht: the forecast API for
 * wind and air, and the marine API for sea state. Requests are staggered and
 * cached; a failure leaves the previous reading in place rather than blanking
 * the card, because a wall display should degrade to slightly stale, never to
 * empty.
 *
 * The marine model has no data for inland water, so a yacht in a river refit
 * yard legitimately returns nulls for sea state. That is handled, not hidden.
 * -------------------------------------------------------------------------- */

(function () {
  'use strict';

  var Weather = { timer: null, queue: [], busy: false };

  var FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
  var MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';

  Weather.start = function () {
    if (!window.CONFIG.weather.enabled) return;
    refreshAll();
    Weather.timer = setInterval(refreshAll, window.CONFIG.weather.refreshMinutes * 60000);
  };

  Weather.stop = function () {
    clearInterval(Weather.timer);
  };

  function refreshAll() {
    var stagger = window.CONFIG.weather.staggerMs;
    window.Store.vessels.forEach(function (v, i) {
      if (!v.derived || v.derived.lat == null) return;
      setTimeout(function () { refreshOne(v); }, i * stagger);
    });
  }

  function refreshOne(v) {
    var lat = v.derived.lat, lon = v.derived.lon;
    if (lat == null || lon == null) return;

    var forecast = fetchJson(FORECAST_URL + '?' + params({
      latitude: lat.toFixed(3),
      longitude: lon.toFixed(3),
      current: 'temperature_2m,apparent_temperature,relative_humidity_2m,' +
               'wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,pressure_msl',
      wind_speed_unit: 'kn',
      timezone: 'auto'
    }));

    var marine = fetchJson(MARINE_URL + '?' + params({
      latitude: lat.toFixed(3),
      longitude: lon.toFixed(3),
      current: 'wave_height,wave_direction,wave_period,swell_wave_height,' +
               'swell_wave_period,sea_surface_temperature'
    }));

    Promise.all([forecast, marine]).then(function (results) {
      var f = results[0], m = results[1];
      if (!f && !m) return;                       // both failed; keep what we had

      var previous = v.weather || {};
      var fc = (f && f.current) || {};
      var mc = (m && m.current) || {};

      window.Store.applyWeather(v.yacht.mmsi, {
        at: new Date(),
        airTemp: pick(fc.temperature_2m, previous.airTemp),
        feelsLike: pick(fc.apparent_temperature, previous.feelsLike),
        humidity: pick(fc.relative_humidity_2m, previous.humidity),
        pressure: pick(fc.pressure_msl, previous.pressure),
        windSpeed: pick(fc.wind_speed_10m, previous.windSpeed),
        windGust: pick(fc.wind_gusts_10m, previous.windGust),
        windDirection: pick(fc.wind_direction_10m, previous.windDirection),
        weatherCode: pick(fc.weather_code, previous.weatherCode),
        // Marine values are legitimately null inland — don't inherit a stale
        // sea state from the last time this yacht was offshore.
        waveHeight: mc.wave_height != null ? mc.wave_height : null,
        waveDirection: mc.wave_direction != null ? mc.wave_direction : null,
        wavePeriod: mc.wave_period != null ? mc.wave_period : null,
        swellHeight: mc.swell_wave_height != null ? mc.swell_wave_height : null,
        swellPeriod: mc.swell_wave_period != null ? mc.swell_wave_period : null,
        seaTemp: mc.sea_surface_temperature != null ? mc.sea_surface_temperature : null,
        marineAvailable: !!m && mc.wave_height != null,
        timeZone: (f && f.timezone) || previous.timeZone || null,
        utcOffsetSeconds: f && f.utc_offset_seconds != null
          ? f.utc_offset_seconds : previous.utcOffsetSeconds
      });
    });
  }

  function pick(value, fallback) {
    return value != null ? value : (fallback != null ? fallback : null);
  }

  function params(obj) {
    return Object.keys(obj).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]);
    }).join('&');
  }

  function fetchJson(url) {
    // A hung request must not stall the next refresh cycle.
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timeout = setTimeout(function () { if (controller) controller.abort(); }, 12000);
    return fetch(url, controller ? { signal: controller.signal } : undefined)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (v) { clearTimeout(timeout); return v; });
  }

  /* --- Presentation helpers ---------------------------------------------- */

  // WMO weather interpretation codes, condensed to what fits on a wall board.
  var WMO = {
    0: 'Clear', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Freezing fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
    56: 'Freezing drizzle', 57: 'Freezing drizzle',
    61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    66: 'Freezing rain', 67: 'Freezing rain',
    71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
    80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers',
    85: 'Snow showers', 86: 'Snow showers',
    95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail'
  };

  Weather.describe = function (code) {
    return code == null ? '—' : (WMO[code] || '—');
  };

  // Beaufort force — the scale a bridge actually talks in.
  var BEAUFORT = [
    [1, 0, 'Calm'], [4, 1, 'Light air'], [7, 2, 'Light breeze'],
    [11, 3, 'Gentle breeze'], [17, 4, 'Moderate breeze'], [22, 5, 'Fresh breeze'],
    [28, 6, 'Strong breeze'], [34, 7, 'Near gale'], [41, 8, 'Gale'],
    [48, 9, 'Severe gale'], [56, 10, 'Storm'], [64, 11, 'Violent storm']
  ];

  Weather.beaufort = function (knots) {
    if (knots == null) return null;
    for (var i = 0; i < BEAUFORT.length; i++) {
      if (knots < BEAUFORT[i][0]) return { force: BEAUFORT[i][1], label: BEAUFORT[i][2] };
    }
    return { force: 12, label: 'Hurricane force' };
  };

  // Douglas sea state from significant wave height.
  Weather.seaState = function (metres) {
    if (metres == null) return null;
    if (metres < 0.1) return 'Calm';
    if (metres < 0.5) return 'Smooth';
    if (metres < 1.25) return 'Slight';
    if (metres < 2.5) return 'Moderate';
    if (metres < 4) return 'Rough';
    if (metres < 6) return 'Very rough';
    if (metres < 9) return 'High';
    return 'Very high';
  };

  window.Weather = Weather;
})();
