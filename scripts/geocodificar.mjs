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

// extrae "calle + número" quitando notas/landmarks que confunden al geocodificador
function calle(dir) {
  let s = String(dir || "").split("(")[0];
  s = s.replace(
    /,?\s*(frente a|diagonal a?|al lado de|contiguo a?|detr[aá]s de|cerca del?|junto a|explanada.*|esquina donde.*|planta baja|local\b.*|piso\b.*|mezzanina.*|sede\b.*).*/i,
    ""
  );
  return s.replace(/\s+/g, " ").replace(/[,\s]+$/, "").trim();
}

const db = JSON.parse(readFileSync(RUTA, "utf8"));
const pendientes = db.centros.filter((c) => c.lat == null || c.lng == null);
console.log(`📍 Centros sin coordenadas: ${pendientes.length}`);

let ok = 0,
  fallo = 0;

for (const c of pendientes) {
  // intentos del más preciso al más general
  const calleLimpia = calle(c.dir);
  const intentos = [];
  if (calleLimpia && /\d/.test(calleLimpia)) {
    intentos.push([calleLimpia, c.ciudad, c.pais].filter(Boolean).join(", "));
  }
  intentos.push([c.dir, c.ciudad, c.estado, c.pais].filter(Boolean).join(", "));
  intentos.push([c.ciudad, c.estado, c.pais].filter(Boolean).join(", "));

  let coord = null;
  for (const q of intentos) {
    try {
      coord = await geocodificar(q);
    } catch (e) {}
    await sleep(PAUSA_MS);
    if (coord) break;
  }

  if (coord) {
    c.lat = coord.lat;
    c.lng = coord.lng;
    ok++;
    console.log(`  ✅ ${c.org} (${c.ciudad}) → ${coord.lat}, ${coord.lng}`);
  } else {
    fallo++;
    console.log(`  ⏭️  sin resultado: ${c.org} (${c.ciudad})`);
  }
}

if (ok > 0) {
  writeFileSync(RUTA, JSON.stringify(db, null, 2) + "\n", "utf8");
}
console.log(`\n✅ Geocodificados ${ok}. Sin resultado: ${fallo}.`);
