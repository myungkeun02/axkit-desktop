import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre runs tile work in a worker that lives in its own file; let Vite bundle it so it loads in dev and in the app.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { bounds, type Mode } from '../core/routes';
import './maps.css';

// A map drawn with MapLibre on OpenFreeMap tiles (no key; the attribution must stay). Places and routes come from
// the Mac (PROTOCOL-REQUESTS.md D7); this only draws them.

maplibregl.setWorkerUrl(workerUrl);

const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
const dark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;

export interface MapMarker {
  id?: string;
  lat: number;
  lng: number;
  /** Short text inside the pin ("1", "집"). */
  label: string;
  title?: string;
  kind?: 'home' | 'stop';
}

export interface MapRoute {
  id: string;
  mode: Mode | string;
  path: [number, number][];
  /** Drawn on top and thicker; others fade when one is highlighted. */
  highlighted?: boolean;
}

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const modeColor = (mode: string) => (mode === 'car' ? token('--orange', '#ff9500') : mode === 'walk' ? token('--text2', '#888') : token('--accent', '#007aff'));

/** Show place names in Korean when the tiles have them. */
function koreanLabels(map: MLMap) {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type !== 'symbol') continue;
    const field = map.getLayoutProperty(layer.id, 'text-field');
    if (!field) continue;
    try { map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:ko'], ['get', 'name']]); } catch { /* keep the style's own */ }
  }
}

function routeData(routes: MapRoute[]) {
  const any = routes.some((r) => r.highlighted);
  // Highlighted last so it draws on top.
  const ordered = [...routes].sort((a, b) => Number(!!a.highlighted) - Number(!!b.highlighted));
  return {
    type: 'FeatureCollection' as const,
    features: ordered.filter((r) => r.path.length > 1).map((r) => ({
      type: 'Feature' as const,
      properties: { id: r.id, mode: r.mode, color: modeColor(r.mode), width: r.highlighted ? 6 : 4, opacity: any && !r.highlighted ? 0.35 : 0.95, walk: r.mode === 'walk' ? 1 : 0 },
      geometry: { type: 'LineString' as const, coordinates: r.path },
    })),
  };
}

function addRouteLayers(map: MLMap, routes: MapRoute[]) {
  if (map.getSource('ax-routes')) return;
  map.addSource('ax-routes', { type: 'geojson', data: routeData(routes) });
  // A soft casing under every line so it reads on any tile colour.
  map.addLayer({ id: 'ax-routes-casing', type: 'line', source: 'ax-routes', filter: ['==', ['get', 'walk'], 0],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': dark() ? '#000' : '#fff', 'line-width': ['+', ['get', 'width'], 3], 'line-opacity': ['*', ['get', 'opacity'], 0.8] } });
  map.addLayer({ id: 'ax-routes-line', type: 'line', source: 'ax-routes', filter: ['==', ['get', 'walk'], 0],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'] } });
  map.addLayer({ id: 'ax-routes-walk', type: 'line', source: 'ax-routes', filter: ['==', ['get', 'walk'], 1],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': [1, 2], 'line-opacity': ['get', 'opacity'] } });
}

function fit(map: MLMap, markers: MapMarker[], routes: MapRoute[], focus: string | null | undefined, animate: boolean) {
  const focused = focus ? routes.filter((r) => r.id === focus || r.id.startsWith(`${focus}:`)) : [];
  const pts: [number, number][] = focused.length
    ? focused.flatMap((r) => r.path)
    : [...markers.map((m) => [m.lng, m.lat] as [number, number]), ...routes.flatMap((r) => r.path)];
  const b = bounds(pts);
  if (!b) return;
  const single = b[0][0] === b[1][0] && b[0][1] === b[1][1];
  if (single) map.jumpTo({ center: b[0], zoom: 14 });
  else map.fitBounds(b, { padding: { top: 48, bottom: 48, left: 48, right: 48 }, maxZoom: 15, duration: animate ? 700 : 0 });
}

function pin(m: MapMarker): HTMLElement {
  const el = document.createElement('div');
  el.className = `ax-pin${m.kind === 'home' ? ' home' : ''}`;
  el.textContent = m.label;
  if (m.title) {
    el.title = m.title;
    el.setAttribute('aria-label', m.title);
  }
  return el;
}

export function MapView({ markers, routes = [], height = 280, interactive = true, focus }: {
  markers: MapMarker[]; routes?: MapRoute[]; height?: number; interactive?: boolean; focus?: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const pins = useRef<maplibregl.Marker[]>([]);
  const latest = useRef({ markers, routes, focus });
  latest.current = { markers, routes, focus };

  // Create once; switch style when the system appearance changes.
  useEffect(() => {
    if (!box.current) return;
    const m = new maplibregl.Map({
      container: box.current,
      style: dark() ? STYLE_DARK : STYLE_LIGHT,
      center: [126.978, 37.5665],
      zoom: 11,
      interactive,
      attributionControl: { compact: true },
      cooperativeGestures: false,
      fadeDuration: 0,
    });
    if (interactive) m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.current = m;
    const onStyle = () => {
      koreanLabels(m);
      addRouteLayers(m, latest.current.routes);
    };
    m.on('style.load', onStyle);
    m.once('load', () => fit(m, latest.current.markers, latest.current.routes, latest.current.focus, false));
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onScheme = () => m.setStyle(dark() ? STYLE_DARK : STYLE_LIGHT);
    media?.addEventListener('change', onScheme);
    const ro = new ResizeObserver(() => m.resize());
    ro.observe(box.current);
    return () => {
      media?.removeEventListener('change', onScheme);
      ro.disconnect();
      pins.current.forEach((p) => p.remove());
      pins.current = [];
      m.remove();
      map.current = null;
    };
  }, [interactive]);

  // Pins.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    pins.current.forEach((p) => p.remove());
    pins.current = markers.map((mk) => new maplibregl.Marker({ element: pin(mk), anchor: 'center' }).setLngLat([mk.lng, mk.lat]).addTo(m));
  }, [markers]);

  // Lines and framing.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const src = m.getSource('ax-routes') as GeoJSONSource | undefined;
    if (src) src.setData(routeData(routes));
    if (m.loaded()) fit(m, markers, routes, focus, true);
  }, [routes, markers, focus]);

  return <div ref={box} className="ax-map" style={{ height }} role="img" aria-label="지도" />;
}

/** A small still map with one pin, for a single place (a plan, a message). */
export function PlaceMap({ name, lat, lng, height = 160 }: { name: string; lat: number; lng: number; height?: number }) {
  return <MapView markers={[{ lat, lng, label: '', title: name }]} height={height} interactive={false} />;
}
