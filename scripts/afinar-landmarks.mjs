#!/usr/bin/env node
/**
 * Afinado por BARRIO/LANDMARK para los centros que quedaron en el centro de la
 * ciudad (coordenada compartida con otros). Muchos tienen el barrio dentro de
 * la dirección (Altamira, Catia, Curumo...) aunque sin número de calle.
 *
 * Estrategia: probar la dirección completa y cada segmento (separado por comas)
 * como nombre de lugar. Acepta el primero que caiga DENTRO de la misma ciudad
 * (≤ 30 km del punto actual) y que sea distinto del centroide. Seguro y conservador.
 *
 * Uso: node scripts/afinar-landmarks.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";

const RUTA = "data/centros.json";
const UA = "centros-acopio-vzla/1.0 (https://centros-acopio-vzla.com)";
const PAUSA_MS = 1200;
const MAX_KM = 30; // debe quedarse dentro de la misma ciudad
const MIN_KM = 0.25; // que realmente se mueva a algo más específico

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function haversine(la1, lo1, la2, lo2) {
  const R = 6371, t = (x) => (x * Math.PI) / 180;
  const dLa = t(la2 - la1), dLo = t(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(t(la1)) * Math.cos(t(la2)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
async function geo(q) {
  const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q), { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const a = await r.json();
  if (Array.isArray(a) && a.length) {
    const lat = +(+a[0].lat).toFixed(6), lng = +(+a[0].lon).toFixed(6);
    if (isFinite(lat) && isFinite(lng)) return { lat, lng };
  }
  return null;
}

// segmentos de la dirección que parecen un nombre de lugar (barrio, parque, sector)
function segmentos(dir) {
  return String(dir || "")
    .split(/[,(]/)
    .map((s) =>
      s
        .replace(/^\s*(urb\.?|urbanizaci[oó]n|sector|av\.?|avenida|calle|c\/|edif\.?|edificio|quinta|conjunto residencial|cc|c\.c\.|centro comercial|parroquia|frente a|diagonal a?|al lado de|entre)\s+/i, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter((s) => s.length >= 4 && /[a-záéíóúñ]{4,}/i.test(s) && !/^\d/.test(s) && !/transversal|entre |esquina/i.test(s));
}

const db = JSON.parse(readFileSync(RUTA, "utf8"));

// solo los que comparten coordenada (centroides de ciudad)
const cuenta = {};
db.centros.forEach((c) => { if (c.lat != null) { const k = c.lat + "," + c.lng; cuenta[k] = (cuenta[k] || 0) + 1; } });
const objetivos = db.centros.filter((c) => c.lat != null && cuenta[c.lat + "," + c.lng] > 1);
console.log(`📍 Centros en centroide de ciudad: ${objetivos.length}`);

let afinados = 0;
for (const c of objetivos) {
  const intentos = [c.dir, ...segmentos(c.dir)].map((s) => `${s}, ${c.ciudad}, ${c.pais}`);
  const vistos = new Set();
  for (const q of intentos) {
    if (vistos.has(q)) continue;
    vistos.add(q);
    let r = null;
    try { r = await geo(q); } catch {}
    await sleep(PAUSA_MS);
    if (!r) continue;
    const dist = haversine(c.lat, c.lng, r.lat, r.lng);
    if (dist >= MIN_KM && dist <= MAX_KM) {
      console.log(`  ✅ ${c.org} (${c.ciudad}) +${dist.toFixed(1)}km → ${r.lat}, ${r.lng}  [${q.split(",")[0]}]`);
      c.lat = r.lat; c.lng = r.lng;
      afinados++;
      break;
    }
  }
}

if (afinados > 0) writeFileSync(RUTA, JSON.stringify(db, null, 2) + "\n", "utf8");
console.log(`\n📍 Afinados por barrio: ${afinados} de ${objetivos.length}.`);
