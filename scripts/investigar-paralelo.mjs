#!/usr/bin/env node
/**
 * Orquestador PARALELO: lanza varios agentes (claude -p) a la vez, uno por
 * REGIÓN, cada uno investigando centros de acopio con búsqueda web. Luego
 * fusiona (dedup conservador, nunca borra), y deja un INFORME de lo encontrado.
 *
 * Usa tu Claude Code ya autenticado (sin API key de pago).
 * El geocodificado y el commit/push los hace run-local.sh después.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";

const RUTA = "data/centros.json";
const DIR_INFORMES = "scripts/informes";
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || "300000", 10);

// --- regiones (cada una corre en su propio agente, en paralelo) ---
const REGIONES = [
  { nombre: "Venezuela", paises: ["Venezuela"], foco: "TODOS los estados de Venezuela, con énfasis en los de poca cobertura (Portuguesa/Acarigua, Cojedes, Yaracuy, Sucre, Nueva Esparta, Apure, Amazonas, Delta Amacuro, Guárico, Trujillo)" },
  { nombre: "Norteamérica", paises: ["Estados Unidos", "Canadá", "México"], foco: "Estados Unidos (todas las ciudades), Canadá y México" },
  { nombre: "Centroamérica", paises: ["Guatemala", "Honduras", "El Salvador", "Nicaragua", "Costa Rica", "Panamá", "Belice"], foco: "Guatemala, Honduras, El Salvador, Nicaragua, Costa Rica, Panamá y Belice" },
  { nombre: "Caribe", paises: ["República Dominicana", "Puerto Rico", "Cuba", "Trinidad y Tobago", "Aruba", "Curazao", "Jamaica"], foco: "República Dominicana, Puerto Rico, Cuba, Trinidad y Tobago, Aruba, Curazao y Jamaica" },
  { nombre: "Andina", paises: ["Colombia", "Ecuador", "Perú", "Bolivia"], foco: "Colombia, Ecuador, Perú y Bolivia (incluyendo ciudades secundarias)" },
  { nombre: "Cono Sur", paises: ["Chile", "Argentina", "Uruguay", "Paraguay", "Brasil"], foco: "Chile, Argentina, Uruguay, Paraguay y Brasil" },
  { nombre: "Europa sur/oeste", paises: ["España", "Portugal", "Italia", "Francia", "Andorra"], foco: "España, Portugal, Italia, Francia y Andorra" },
  { nombre: "Europa centro/norte", paises: ["Alemania", "Reino Unido", "Irlanda", "Países Bajos", "Bélgica", "Suiza", "Austria", "Suecia", "Noruega"], foco: "Alemania, Reino Unido, Irlanda, Países Bajos, Bélgica, Suiza, Austria, Suecia y Noruega" },
];

// --- utilidades de datos ---
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
const clave = (c) => `${norm(c.pais)}|${norm(c.org)}|${norm(c.ciudad)}|${norm(c.dir)}`;
const txt = (v) => (v == null ? "" : String(v).trim());

function promptRegion(region, listaExistente) {
  return `Eres investigador de CENTROS DE ACOPIO para las víctimas de los terremotos del 24 de junio de 2026 en Venezuela (magnitudes 7,2 y 7,5).

Usa la búsqueda web (WebSearch) para encontrar centros de acopio NUEVOS en: ${region.foco}. Son puntos físicos donde la comunidad venezolana, consulados, embajadas u ONG recolectan donaciones para enviar a Venezuela (o, en Venezuela, para los afectados).

REGLAS ESTRICTAS (modo conservador — esta info manda gente a lugares físicos):
1. Solo incluye un centro con FUENTE pública verificable (URL) y datos suficientes: país, organización, ciudad y dirección. Si dudas, NO lo incluyas.
2. NO inventes direcciones, teléfonos ni coordenadas. Dato que no encuentres = "".
3. NO repitas los que ya están en la lista existente de abajo.

Responde ÚNICAMENTE con un arreglo JSON (sin texto, sin markdown):
[{"pais":"","org":"","estado":"","ciudad":"","municipio":"","dir":"","reciben":"","tel":"","info":"","fuente":"URL"}]
Si no hay nada nuevo confiable, responde [].

LISTA EXISTENTE (no repetir):
${listaExistente || "(vacía)"}`;
}

function lanzarAgente(prompt) {
  return new Promise((resolve) => {
    const ch = spawn("claude", ["-p", "--allowedTools", "WebSearch", "WebFetch", "--output-format", "text"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { ch.kill("SIGKILL"); resolve({ texto: out, error: "timeout" }); }, TIMEOUT_MS);
    ch.stdout.on("data", (d) => (out += d));
    ch.stderr.on("data", (d) => (err += d));
    ch.on("error", (e) => { clearTimeout(timer); resolve({ texto: "", error: e.message }); });
    ch.on("close", () => { clearTimeout(timer); resolve({ texto: out, error: err && !out ? err.slice(0, 200) : null }); });
    ch.stdin.write(prompt); ch.stdin.end();
  });
}

function extraerArray(t) {
  try { const v = JSON.parse(t); return Array.isArray(v) ? v : v.centros || []; } catch {}
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (f) { try { const v = JSON.parse(f[1]); return Array.isArray(v) ? v : v.centros || []; } catch {} }
  const i = t.indexOf("["), j = t.lastIndexOf("]");
  if (i !== -1 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch {} }
  return [];
}

function limpiar(c) {
  return {
    pais: txt(c.pais), org: txt(c.org), estado: txt(c.estado) || txt(c.ciudad),
    ciudad: txt(c.ciudad), municipio: txt(c.municipio), dir: txt(c.dir),
    reciben: txt(c.reciben), tel: txt(c.tel), info: txt(c.info), lat: null, lng: null,
    fuente: txt(c.fuente),
  };
}
const valido = (c) => ["pais", "org", "ciudad", "dir", "fuente"].every((k) => c[k]);

function fechaSello() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// --- main ---
const db = JSON.parse(readFileSync(RUTA, "utf8"));
const indice = new Set(db.centros.map(clave));

console.log(`🚀 Lanzando ${REGIONES.length} agentes en paralelo... (${db.centros.length} centros actuales)`);

const resultados = await Promise.all(
  REGIONES.map(async (region) => {
    const lista = db.centros
      .filter((c) => region.paises.some((p) => norm(p) === norm(c.pais)))
      .map((c) => `- ${c.org} (${c.ciudad}, ${c.estado})`)
      .join("\n");
    const { texto, error } = await lanzarAgente(promptRegion(region, lista));
    const candidatos = extraerArray(texto).map(limpiar).filter(valido);
    return { region: region.nombre, candidatos, error };
  })
);

// fusión conservadora
const informe = [];
let totalNuevos = 0;
for (const r of resultados) {
  let nuevos = 0;
  const porPais = {};
  for (const c of r.candidatos) {
    const k = clave(c);
    if (indice.has(k)) continue;
    indice.add(k);
    const { fuente, ...publico } = c;
    db.centros.push(publico);
    nuevos++;
    porPais[c.pais] = (porPais[c.pais] || 0) + 1;
  }
  totalNuevos += nuevos;
  informe.push({ region: r.region, encontrados: r.candidatos.length, nuevos, porPais, error: r.error });
  const det = Object.entries(porPais).map(([p, n]) => `${p}:${n}`).join(", ");
  console.log(`  [${r.region}] encontrados ${r.candidatos.length}, nuevos ${nuevos}${det ? " (" + det + ")" : ""}${r.error ? " ⚠️ " + r.error : ""}`);
}

if (totalNuevos > 0) {
  writeFileSync(RUTA, JSON.stringify(db, null, 2) + "\n", "utf8");
}

// --- informe ---
mkdirSync(DIR_INFORMES, { recursive: true });
const sello = fechaSello();
const md = [
  `# Informe del agente — ${sello.replace("_", " ")}`,
  ``,
  `**Nuevos centros agregados:** ${totalNuevos}  ·  **Total ahora:** ${db.centros.length}`,
  ``,
  `| Región | Encontrados | Nuevos | Detalle | Estado |`,
  `|--------|------------|--------|---------|--------|`,
  ...informe.map((i) => {
    const det = Object.entries(i.porPais).map(([p, n]) => `${p}: ${n}`).join(", ") || "—";
    return `| ${i.region} | ${i.encontrados} | ${i.nuevos} | ${det} | ${i.error ? "⚠️ " + i.error : "ok"} |`;
  }),
  ``,
].join("\n");
writeFileSync(`${DIR_INFORMES}/informe-${sello}.md`, md, "utf8");
writeFileSync(`${DIR_INFORMES}/ULTIMO.md`, md, "utf8");

console.log(`\n✅ ${totalNuevos} nuevos. Informe: ${DIR_INFORMES}/informe-${sello}.md`);
