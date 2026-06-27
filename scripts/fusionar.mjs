#!/usr/bin/env node
/**
 * Fusiona archivos JSON de candidatos (de los agentes por región) dentro de
 * data/centros.json, de forma conservadora: valida, deduplica y nunca borra.
 *
 * Uso: node scripts/fusionar.mjs /tmp/region-1.json /tmp/region-2.json ...
 * Imprime un informe de lo agregado por país.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const RUTA = "data/centros.json";
const archivos = process.argv.slice(2);

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const clave = (c) => `${norm(c.pais)}|${norm(c.org)}|${norm(c.ciudad)}|${norm(c.dir)}`;
const esNumOnull = (v) => v === null || (typeof v === "number" && isFinite(v));
const txt = (v) => (v == null ? "" : String(v).trim());

function limpiar(c) {
  const o = {
    pais: txt(c.pais),
    org: txt(c.org),
    estado: txt(c.estado) || txt(c.ciudad), // si no hay estado/región, usa la ciudad
    ciudad: txt(c.ciudad),
    municipio: txt(c.municipio),
    dir: txt(c.dir),
    reciben: txt(c.reciben),
    tel: txt(c.tel),
    info: txt(c.info),
    lat: null,
    lng: null,
    fuente: txt(c.fuente),
  };
  return o;
}
function valido(c) {
  for (const k of ["pais", "org", "ciudad", "dir", "fuente"])
    if (!c[k]) return false;
  return true;
}

const db = JSON.parse(readFileSync(RUTA, "utf8"));
const indice = new Set(db.centros.map(clave));

const porPais = {};
let agregados = 0,
  descartados = 0,
  duplicados = 0;

for (const f of archivos) {
  if (!existsSync(f)) {
    console.log(`  (saltado: no existe ${f})`);
    continue;
  }
  let arr;
  try {
    arr = JSON.parse(readFileSync(f, "utf8"));
  } catch {
    console.log(`  (saltado: JSON inválido en ${f})`);
    continue;
  }
  if (!Array.isArray(arr)) continue;
  for (const raw of arr) {
    const c = limpiar(raw);
    if (!valido(c)) {
      descartados++;
      continue;
    }
    const k = clave(c);
    if (indice.has(k)) {
      duplicados++;
      continue;
    }
    indice.add(k);
    const { fuente, ...publico } = c;
    db.centros.push(publico);
    agregados++;
    porPais[c.pais] = (porPais[c.pais] || 0) + 1;
  }
}

if (agregados > 0) {
  writeFileSync(RUTA, JSON.stringify(db, null, 2) + "\n", "utf8");
}

console.log(`\n📊 Fusión: ${agregados} nuevos, ${duplicados} duplicados, ${descartados} descartados (sin fuente/datos).`);
if (agregados) {
  console.log("Nuevos por país:");
  Object.entries(porPais)
    .sort((a, b) => b[1] - a[1])
    .forEach(([p, n]) => console.log(`  - ${p}: ${n}`));
}
console.log(`Total ahora: ${db.centros.length}`);
