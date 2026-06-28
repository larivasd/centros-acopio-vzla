#!/usr/bin/env node
/**
 * Afina las coordenadas GPS: re-geocodifica los centros que tienen dirección
 * con número de calle, para pasarlos del "centro de la ciudad" a su punto real.
 *
 * Seguro: limpia las notas que confunden al geocodificador y SOLO actualiza si
 * el nuevo punto está dentro de la misma ciudad (≤ 60 km del actual), para no
 * saltar por error a otro lugar. Los que no tienen número de calle no se tocan.
 *
 * Uso: node scripts/afinar-gps.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";

const RUTA = "data/centros.json";
const UA = "centros-acopio-vzla/1.0 (https://centros-acopio-vzla.com)";
const PAUSA_MS = 1200;
const MAX_KM = 60; // tolerancia: el punto afinado debe estar en la misma zona

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function haversine(la1, lo1, la2, lo2) {
  const R = 6371, t = (x) => (x * Math.PI) / 180;
  const dLa = t(la2 - la1), dLo = t(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(t(la1)) * Math.cos(t(la2)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// extrae la parte de "calle + número" quitando notas/landmarks
function calle(dir) {
  let s = String(dir || "").split("(")[0];
  s = s.replace(
    /,?\s*(frente a|diagonal a?|al lado de|contiguo a?|detr[aá]s de|cerca del?|junto a|explanada.*|esquina donde.*|planta baja|local\b.*|piso\b.*|mezzanina.*|sede\b.*).*/i,
    ""
  );
  return s.replace(/\s+/g, " ").replace(/[,\s]+$/, "").trim();
}
const tieneNumero = (s) => /\d/.test(s);

async function geo(q) {
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q);
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) return null;
  const a = await r.json();
  if (Array.isArray(a) && a.length) {
    const lat = +(+a[0].lat).toFixed(6), lng = +(+a[0].lon).toFixed(6);
    if (isFinite(lat) && isFinite(lng)) return { lat, lng };
  }
  return null;
}

const db = JSON.parse(readFileSync(RUTA, "utf8"));

let candidatos = 0, afinados = 0, sinCambio = 0, fuera = 0;
for (const c of db.centros) {
  const base = calle(c.dir);
  if (!base || !tieneNumero(base)) continue; // sin número de calle: no se toca
  candidatos++;
  const q = `${base}, ${c.ciudad}, ${c.pais}`;
  let r = null;
  try {
    r = await geo(q);
  } catch {}
  await sleep(PAUSA_MS);
  if (!r) {
    continue;
  }
  const dist = c.lat != null ? haversine(c.lat, c.lng, r.lat, r.lng) : 0;
  if (c.lat != null && dist > MAX_KM) {
    fuera++; // resultado sospechoso (otra ciudad): se descarta
    continue;
  }
  if (r.lat === c.lat && r.lng === c.lng) {
    sinCambio++;
    continue;
  }
  console.log(`  ✅ ${c.org} (${c.ciudad}) movido ${dist.toFixed(1)} km → ${r.lat}, ${r.lng}`);
  c.lat = r.lat;
  c.lng = r.lng;
  afinados++;
}

if (afinados > 0) {
  writeFileSync(RUTA, JSON.stringify(db, null, 2) + "\n", "utf8");
}
console.log(`\n📍 Afinados ${afinados} de ${candidatos} con dirección (sin cambio ${sinCambio}, descartados por lejanía ${fuera}).`);
