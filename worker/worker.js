const ERLAUBT = ['https://claudemn61.github.io', 'http://localhost:8765'];

// Cloudflare Worker: holt eine Rezeptseite für die Rezeptbuch-App (CORS-Zwischendienst).
// Aufruf: https://<dein-worker>.workers.dev/?url=https://beispiel.ch/rezept

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ERLAUBT.includes(origin) ? origin : ERLAUBT[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin'
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (origin && !ERLAUBT.includes(origin)) return new Response('Nicht erlaubt', { status: 403, headers: cors });
    const target = new URL(req.url).searchParams.get('url') || '';
    if (!/^https?:\/\//i.test(target)) return new Response('Ungültige Adresse', { status: 400, headers: cors });
    try {
      const r = await fetch(target, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Rezeptbuch)', 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'de-CH,de;q=0.9,en;q=0.6' }
      });
      if (new URL(req.url).searchParams.get('img')) {
        const ct = r.headers.get('Content-Type') || '';
        if (!r.ok || !/^image\//i.test(ct)) return new Response('Kein Bild', { status: 415, headers: cors });
        const buf = await r.arrayBuffer();
        if (buf.byteLength > 8000000) return new Response('Bild zu gross', { status: 413, headers: cors });
        return new Response(buf, { status: 200, headers: { ...cors, 'Content-Type': ct } });
      }
      const text = (await r.text()).slice(0, 3000000);
      return new Response(text, { status: r.status, headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (e) {
      return new Response('Seite nicht erreichbar', { status: 502, headers: cors });
    }
  }
};
