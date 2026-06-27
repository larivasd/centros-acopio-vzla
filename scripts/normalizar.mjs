#!/usr/bin/env node
/**
 * Normalizador de datos: corrige país y estado/región mal escritos para que
 * los filtros del sitio coincidan, y elimina duplicados exactos.
 *
 * - País: mapea variantes comunes a un nombre canónico (vzla → Venezuela,
 *   mexico → México, eeuu → Estados Unidos, etc.).
 * - Estado (Venezuela): corrige acentos/mayúsculas y alias (Vargas → La Guaira).
 * - Limpia espacios sobrantes en todos los campos de texto.
 * - Deduplica por país|org|ciudad|dir, fusionando datos no vacíos.
 *
 * Uso: node scripts/normalizar.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";

const RUTA = "data/centros.json";

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

// --- país canónico ---
const PAIS = {
  "venezuela": "Venezuela",
  "republica bolivariana de venezuela": "Venezuela",
  "vzla": "Venezuela",
  "ve": "Venezuela",
  "mexico": "México",
  "colombia": "Colombia",
  "chile": "Chile",
  "espana": "España",
  "spain": "España",
  "estados unidos": "Estados Unidos",
  "eeuu": "Estados Unidos",
  "ee uu": "Estados Unidos",
  "usa": "Estados Unidos",
  "united states": "Estados Unidos",
  "canada": "Canadá",
  "puerto rico": "Puerto Rico",
  "trinidad y tobago": "Trinidad y Tobago",
  "curazao": "Curazao",
  "curacao": "Curazao",
  "francia": "Francia",
  "france": "Francia",
  "italia": "Italia",
  "alemania": "Alemania",
  "uruguay": "Uruguay",
  "paraguay": "Paraguay",
  "panama": "Panamá",
  "peru": "Perú",
  "argentina": "Argentina",
  "ecuador": "Ecuador",
  "republica dominicana": "República Dominicana",
  "brasil": "Brasil",
  "brazil": "Brasil",
  "italia": "Italia",
  "portugal": "Portugal",
};

// --- estados de Venezuela (canónico) + alias ---
const ESTADOS_VE = [
  "Amazonas", "Anzoátegui", "Apure", "Aragua", "Barinas", "Bolívar",
  "Carabobo", "Cojedes", "Delta Amacuro", "Distrito Capital", "Falcón",
  "Guárico", "La Guaira", "Lara", "Mérida", "Miranda", "Monagas",
  "Nueva Esparta", "Portuguesa", "Sucre", "Táchira", "Trujillo",
  "Yaracuy", "Zulia",
];
const ESTADO_VE = {};
ESTADOS_VE.forEach((e) => (ESTADO_VE[norm(e)] = e));
// alias
ESTADO_VE["vargas"] = "La Guaira";
ESTADO_VE["dtto capital"] = "Distrito Capital";
ESTADO_VE["distrito federal"] = "Distrito Capital";
ESTADO_VE["dc"] = "Distrito Capital";

const limpiarTexto = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

const db = JSON.parse(readFileSync(RUTA, "utf8"));
let cambiosPais = 0,
  cambiosEstado = 0;

for (const c of db.centros) {
  // limpiar todos los campos de texto
  for (const k of ["pais", "org", "estado", "ciudad", "municipio", "dir", "reciben", "tel", "info"]) {
    if (k in c) c[k] = limpiarTexto(c[k]);
  }
  // país canónico
  const pCanon = PAIS[norm(c.pais)];
  if (pCanon && pCanon !== c.pais) {
    c.pais = pCanon;
    cambiosPais++;
  }
  // estado canónico (solo Venezuela)
  if (norm(c.pais) === "venezuela") {
    const eCanon = ESTADO_VE[norm(c.estado)];
    if (eCanon && eCanon !== c.estado) {
      c.estado = eCanon;
      cambiosEstado++;
    }
  }
}

// --- deduplicar (fusionando campos no vacíos) ---
const clave = (c) => `${norm(c.pais)}|${norm(c.org)}|${norm(c.ciudad)}|${norm(c.dir)}`;
const mapa = new Map();
let duplicados = 0;
for (const c of db.centros) {
  const k = clave(c);
  if (!mapa.has(k)) {
    mapa.set(k, c);
  } else {
    duplicados++;
    const orig = mapa.get(k);
    // rellenar campos vacíos del original con los del duplicado
    for (const f of ["municipio", "reciben", "tel", "info"]) {
      if ((!orig[f] || !orig[f].trim()) && c[f]) orig[f] = c[f];
    }
    if (orig.lat == null && c.lat != null) orig.lat = c.lat;
    if (orig.lng == null && c.lng != null) orig.lng = c.lng;
  }
}
const limpios = [...mapa.values()];

const huboCambios =
  cambiosPais > 0 || cambiosEstado > 0 || duplicados > 0;
if (huboCambios) {
  db.centros = limpios;
  writeFileSync(RUTA, JSON.stringify(db, null, 2) + "\n", "utf8");
}
console.log(
  `🧹 Normalización: ${cambiosPais} países corregidos, ${cambiosEstado} estados corregidos, ${duplicados} duplicados fusionados. Total: ${limpios.length}`
);
