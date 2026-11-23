import { Context } from 'koishi'

export interface MapPoint {
  name?: string
  lat: number
  lon: number
}

export interface RouteMapOptions {
  dep: MapPoint & { icao: string }
  arr: MapPoint & { icao: string }
  waypoints: MapPoint[]
  routeText?: string
  distanceNm?: number
  cycle?: string
  token: string
  title?: string
}

const MAPBOX_JS_SOURCES = [
  'https://api.mapbox.com/mapbox-gl-js/v3.12.0/mapbox-gl.js',
  'https://cdn.jsdelivr.net/npm/mapbox-gl@3.12.0/dist/mapbox-gl.js',
  'https://unpkg.com/mapbox-gl@3.12.0/dist/mapbox-gl.js',
]

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function esc(text: string): string {
  return String(text).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]!))
}

function buildHtml(options: RouteMapOptions): string {
  const distance = options.distanceNm ? `${options.distanceNm} NM` : '--'
  const routeText = (options.routeText || '').trim()
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<link href="https://api.mapbox.com/mapbox-gl-js/v3.12.0/mapbox-gl.css" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif;
    background: #0d1117; color: #e6edf3; padding: 22px;
  }
  .card { max-width: 1100px; margin: 0 auto; background: #161b22; border: 1px solid #30363d; border-radius: 14px; overflow: hidden; }
  .head { padding: 18px 22px; border-bottom: 1px solid #30363d; display: flex; align-items: center; gap: 20px; flex-wrap: wrap; }
  .title { font-size: 18px; font-weight: 700; color: #f0883e; }
  .pair { display: flex; align-items: center; gap: 10px; font-family: Consolas, monospace; }
  .icao { font-size: 24px; font-weight: 800; color: #e6edf3; }
  .apt-name { font-size: 12px; color: #8b949e; }
  .plane { color: #f0883e; font-size: 20px; }
  .chips { margin-left: auto; display: flex; gap: 8px; }
  .chip { background: #0d1117; border: 1px solid #30363d; border-radius: 8px; padding: 6px 12px; text-align: center; }
  .chip .k { font-size: 10px; color: #8b949e; }
  .chip .v { font-size: 14px; font-weight: 700; color: #f0883e; }
  .route { padding: 12px 22px; font-family: Consolas, monospace; font-size: 13px; color: #c9d1d9; background: #010409; border-bottom: 1px solid #30363d; word-break: break-word; line-height: 1.7; }
  #map { width: 100%; height: 560px; background: #010409; }
  .foot { padding: 10px 22px; font-size: 11px; color: #6e7681; }
  .m-marker { display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .m-dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #fff; }
  .m-dot.dep { background: #10b981; }
  .m-dot.arr { background: #f97316; }
  .m-dot.wp { width: 7px; height: 7px; background: #38bdf8; border-width: 1px; }
  .m-label { font-size: 10px; color: #e6edf3; background: rgba(13,17,23,.82); padding: 1px 5px; border-radius: 4px; white-space: nowrap; }
</style>
</head>
<body>
  <div class="card">
    <div class="head">
      <div class="title">${esc(options.title || '飞行任务航路图')}</div>
      <div class="pair">
        <span class="icao">${esc(options.dep.icao)}</span>
        <span class="apt-name">${esc(options.dep.name || '')}</span>
        <span class="plane">&#9992;</span>
        <span class="icao">${esc(options.arr.icao)}</span>
        <span class="apt-name">${esc(options.arr.name || '')}</span>
      </div>
      <div class="chips">
        <div class="chip"><div class="k">距离</div><div class="v">${esc(distance)}</div></div>
        <div class="chip"><div class="k">周期</div><div class="v">${esc(options.cycle || '--')}</div></div>
      </div>
    </div>
    ${routeText ? `<div class="route">${esc(routeText)}</div>` : ''}
    <div id="map"></div>
    <div class="foot">航路点 ${options.waypoints.length} 个 · 航线仅供参考</div>
  </div>
  <script>
    window.__flightMapReady = false;
    (function () {
      var TOKEN = ${safeJson(options.token)};
      var SOURCES = ${safeJson(MAPBOX_JS_SOURCES)};
      var DEP = ${safeJson({ lat: options.dep.lat, lon: options.dep.lon, name: options.dep.icao })};
      var ARR = ${safeJson({ lat: options.arr.lat, lon: options.arr.lon, name: options.arr.icao })};
      var WPS = ${safeJson(options.waypoints)};
      var container = document.getElementById('map');

      function finish() {
        if (window.__flightMapReady) return;
        window.__flightMapReady = true;
      }
      function loadMapbox() {
        if (window.mapboxgl) return Promise.resolve();
        return new Promise(function (resolve, reject) {
          var index = 0;
          function next() {
            if (index >= SOURCES.length) return reject(new Error('Mapbox 脚本加载失败'));
            var script = document.createElement('script');
            script.src = SOURCES[index++];
            script.async = true;
            script.onload = function () { window.mapboxgl ? resolve() : next(); };
            script.onerror = next;
            document.head.appendChild(script);
          }
          next();
        });
      }
      function valid(point) {
        return point && isFinite(point.lat) && isFinite(point.lon) && !(point.lat === 0 && point.lon === 0);
      }
      function unroll(points) {
        var out = [], offset = 0;
        points.forEach(function (point) {
          var lon = point.lon + offset;
          if (out.length) {
            var prev = out[out.length - 1].lon;
            if (lon - prev > 180) offset -= 360;
            else if (lon - prev < -180) offset += 360;
          }
          out.push({ lat: point.lat, lon: point.lon + offset, name: point.name, kind: point.kind });
        });
        return out;
      }
      function marker(point, kind) {
        var el = document.createElement('div');
        el.className = 'm-marker';
        var dot = document.createElement('div');
        dot.className = 'm-dot ' + kind;
        el.appendChild(dot);
        if (point.name) {
          var label = document.createElement('div');
          label.className = 'm-label';
          label.textContent = point.name;
          el.appendChild(label);
        }
        new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([point.lon, point.lat]).addTo(map);
      }

      loadMapbox().then(function () {
        if (!TOKEN) { finish(); return; }
        mapboxgl.accessToken = TOKEN;
        window.map = new mapboxgl.Map({
          container: container,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: [DEP.lon, DEP.lat],
          zoom: 4,
          attributionControl: false,
          interactive: false,
          fadeDuration: 0,
          preserveDrawingBuffer: true,
        });
        var map = window.map;
        map.on('error', finish);
        map.on('load', function () {
          var pts = [];
          if (valid(DEP)) pts.push({ lat: DEP.lat, lon: DEP.lon, name: DEP.name, kind: 'dep' });
          WPS.forEach(function (point) {
            if (valid(point)) pts.push({ lat: point.lat, lon: point.lon, name: point.name, kind: 'wp' });
          });
          if (valid(ARR)) pts.push({ lat: ARR.lat, lon: ARR.lon, name: ARR.name, kind: 'arr' });
          if (pts.length < 2) { finish(); return; }

          var path = unroll(pts);
          var coords = path.map(function (point) { return [point.lon, point.lat]; });
          map.addSource('route', {
            type: 'geojson',
            data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } },
          });
          map.addLayer({ id: 'route-base', type: 'line', source: 'route', paint: { 'line-color': '#7c2d12', 'line-width': 7 } });
          map.addLayer({ id: 'route-line', type: 'line', source: 'route', paint: { 'line-color': '#f97316', 'line-width': 3.5 } });

          marker(path[0], 'dep');
          marker(path[path.length - 1], 'arr');
          path.slice(1, -1).forEach(function (point) { marker(point, 'wp'); });

          var bounds = new mapboxgl.LngLatBounds();
          coords.forEach(function (coord) { bounds.extend(coord); });
          map.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 0 });
          map.once('idle', finish);
        });
      }).catch(finish);
      setTimeout(finish, 15000);
    })();
  </script>
</body>
</html>`
}

export async function renderRouteMap(ctx: Context, options: RouteMapOptions): Promise<Buffer | null> {
  if (!options.token) return null

  const page = await ctx.puppeteer.page()
  try {
    await page.setViewport({ width: 1100, height: 800, deviceScaleFactor: 2 })
    await page.setContent(buildHtml(options), { waitUntil: 'load', timeout: 30000 })
    await page.waitForFunction('window.__flightMapReady === true', { timeout: 20000 }).catch(() => {})
    const height = await page.evaluate(() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight))
    await page.setViewport({ width: 1100, height: Math.max(600, height), deviceScaleFactor: 2 })
    return await page.screenshot({ type: 'png', fullPage: true })
  } finally {
    await page.close().catch(() => {})
  }
}
