#!/usr/bin/env node
/**
 * Geocodificador: rellena lat/lng de los centros que no tienen coordenadas,
 * usando OpenStreetMap Nominatim (gratis, sin API key).
 *
 * Estrategia conservadora por cada centro sin coordenadas:
 *   1) intenta con dirección completa (dir, ciudad, estado, país)
 *   2) si falla, intenta a nivel ciudad (ciudad, estado, país)
 * Respeta el límite de Nominatim (1 petición/seg) con un User-Agent válido.
 *
 * Uso: node scripts/geocodificar.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";

const RUTA = "data/centros.json";
const UA = "centros-acopio-vzla/1.0 (https://centros-acopio-vzla.com)";
const PAUSA_MS = 1200;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geocodificar(q) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(q);
  const resp = await fetch(url, { headers: { "User-Agent": UA } });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const arr = await resp.json();
  if (Array.isArray(arr) && arr.length) {
    const lat = parseFloat(arr[0].lat),
      lon = parseFloat(arr[0].lon);
    if (isFinite(lat) && isFinite(lon)) {
      return { lat: +lat.toFixed(6), lng: +lon.toFixed(6) };
    }
  }
  return null;
}

const db = JSON.parse(readFileSync(RUTA, "utf8"));
const pendientes = db.centros.filter((c) => c.lat == null || c.lng == null);
console.log(`📍 Centros sin coordenadas: ${pendientes.length}`);

let ok = 0,
  ciudad = 0,
  fallo = 0;

for (const c of pendientes) {
  const q1 = [c.dir, c.ciudad, c.estado, c.pais].filter(Boolean).join(", ");
  const q2 = [c.ciudad, c.estado, c.pais].filter(Boolean).join(", ");
  let coord = null;
  try {
    coord = await geocodificar(q1);
    await sleep(PAUSA_MS);
    if (!coord && q2 !== q1) {
      coord = await geocodificar(q2);
      await sleep(PAUSA_MS);
      if (coord) ciudad++;
    } else if (coord) {
      ok++;
    }
  } catch (e) {
    console.log(`  ⚠️ error geocodificando ${c.org}: ${e.message}`);
    await sleep(PAUSA_MS);
  }
  if (coord) {
    c.lat = coord.lat;
    c.lng = coord.lng;
    console.log(`  ✅ ${c.org} (${c.ciudad}) → ${coord.lat}, ${coord.lng}`);
  } else {
    fallo++;
    console.log(`  ⏭️  sin resultado: ${c.org} (${c.ciudad})`);
  }
}

if (ok + ciudad > 0) {
  writeFileSync(RUTA, JSON.stringify(db, null, 2) + "\n", "utf8");
  console.log(
    `\n✅ Geocodificados ${ok + ciudad} (${ok} exactos, ${ciudad} a nivel ciudad). Sin resultado: ${fallo}.`
  );
} else {
  console.log("\nSin coordenadas nuevas.");
}
