#!/usr/bin/env node
/**
 * Agente LOCAL de investigación de centros de acopio (Venezuela, terremoto 24/06/2026).
 *
 * Usa tu Claude Code ya autenticado (comando `claude -p`, modo headless) con
 * búsqueda web — NO necesita API key de Anthropic ni genera costo aparte.
 *
 * Flujo:
 *  1. Lee data/centros.json.
 *  2. Le pide a Claude (con WebSearch) centros NUEVOS o datos faltantes.
 *  3. Valida, deduplica y MERGEA de forma CONSERVADORA:
 *       - Solo AGREGA centros bien formados y con fuente verificable.
 *       - ENRIQUECE campos vacíos de existentes (tel, info, GPS).
 *       - NUNCA borra centros existentes.
 *  4. Si hubo cambios, reescribe data/centros.json (el git push lo hace run-local.sh).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

const RUTA = "data/centros.json";
const MAX_NUEVOS = parseInt(process.env.MAX_NUEVOS || "25", 10);
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || "360000", 10); // 6 min

// --- utilidades ---
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const claveCentro = (c) => `${norm(c.org)}|${norm(c.ciudad)}|${norm(c.dir)}`;
const esNumOnull = (v) => v === null || (typeof v === "number" && isFinite(v));
const hoyISO = () => new Date().toISOString().slice(0, 10);

// --- 1. cargar datos ---
const db = JSON.parse(readFileSync(RUTA, "utf8"));
const centros = Array.isArray(db.centros) ? db.centros : [];
const indice = new Map(centros.map((c) => [claveCentro(c), c]));
console.log(`📂 Centros actuales: ${centros.length}`);

const listaExistente = centros
  .map((c) => `- ${c.org} | ${c.dir} (${c.ciudad}, ${c.estado})`)
  .join("\n");

// --- 2. prompt ---
const PROMPT = `Eres un investigador que mantiene un directorio público de CENTROS DE ACOPIO en Venezuela para ayudar a las víctimas de los terremotos del 24 de junio de 2026 (magnitudes 7,2 y 7,5).

Usa la búsqueda web (WebSearch) para encontrar centros de acopio NUEVOS (que NO estén en la lista de abajo) y datos de contacto/ubicación que falten. Busca en prensa venezolana, sitios oficiales y publicaciones públicas de X (Twitter) e Instagram indexadas. Cubre todos los estados afectados.

REGLAS ESTRICTAS (modo conservador — esta info manda gente a lugares físicos):
1. Solo incluye un centro si tienes una FUENTE pública verificable (URL) y datos suficientes: organización, estado, ciudad y dirección. Si dudas, NO lo incluyas.
2. NO inventes direcciones, teléfonos ni coordenadas. Dato que no encuentres = "" (o null para lat/lng).
3. NO repitas centros de la lista existente.
4. Prioriza información reciente y confiable.

IMPORTANTE: responde ÚNICAMENTE con el objeto JSON, sin explicaciones, sin markdown, sin texto antes ni después. Forma exacta:
{"centros":[{"org":"","estado":"","ciudad":"","municipio":"","dir":"","reciben":"","tel":"","info":"","lat":null,"lng":null,"fuente":"URL de dónde lo obtuviste"}]}

Si no hay nada nuevo confiable: {"centros":[]}

LISTA EXISTENTE (no repetir):
${listaExistente}`;

// --- 3. invocar claude headless ---
function consultarAgente() {
  return new Promise((resolve, reject) => {
    const args = [
      "-p",
      "--allowedTools",
      "WebSearch",
      "WebFetch",
      "--output-format",
      "text",
    ];
    const ch = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "",
      err = "";
    const timer = setTimeout(() => {
      ch.kill("SIGKILL");
      reject(new Error(`timeout tras ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);
    ch.stdout.on("data", (d) => (out += d));
    ch.stderr.on("data", (d) => (err += d));
    ch.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ch.on("close", (code) => {
      clearTimeout(timer);
      if (!out.trim() && code !== 0)
        reject(new Error(`claude salió ${code}: ${err.slice(0, 400)}`));
      else resolve(out);
    });
    ch.stdin.write(PROMPT);
    ch.stdin.end();
  });
}

function extraerJSON(texto) {
  try {
    return JSON.parse(texto);
  } catch {}
  const fence = texto.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {}
  }
  const i = texto.indexOf("{");
  const j = texto.lastIndexOf("}");
  if (i !== -1 && j > i) {
    try {
      return JSON.parse(texto.slice(i, j + 1));
    } catch {}
  }
  throw new Error("No se pudo extraer JSON de la respuesta");
}

// --- 4. validación / limpieza ---
function valido(c) {
  if (!c || typeof c !== "object") return false;
  for (const k of ["org", "estado", "ciudad", "dir"])
    if (!c[k] || !String(c[k]).trim()) return false;
  if (!c.fuente || !String(c.fuente).trim()) return false;
  if (!esNumOnull(c.lat ?? null) || !esNumOnull(c.lng ?? null)) return false;
  return true;
}
function limpiar(c) {
  const txt = (v) => (v == null ? "" : String(v).trim());
  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  return {
    org: txt(c.org),
    estado: txt(c.estado),
    ciudad: txt(c.ciudad),
    municipio: txt(c.municipio),
    dir: txt(c.dir),
    reciben: txt(c.reciben),
    tel: txt(c.tel),
    info: txt(c.info),
    lat: esNumOnull(num(c.lat)) ? num(c.lat) : null,
    lng: esNumOnull(num(c.lng)) ? num(c.lng) : null,
    fuente: txt(c.fuente),
  };
}

// --- main ---
(async () => {
  let texto;
  try {
    texto = await consultarAgente();
  } catch (e) {
    console.error("❌ Error invocando claude:", e.message);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = extraerJSON(texto);
  } catch (e) {
    console.error("❌", e.message, "\nRespuesta cruda:\n", texto.slice(0, 1000));
    process.exit(1);
  }

  const candidatos = Array.isArray(parsed.centros) ? parsed.centros : [];
  console.log(`🔎 Candidatos: ${candidatos.length}`);

  let agregados = 0,
    enriquecidos = 0;
  for (const raw of candidatos) {
    const c = limpiar(raw);
    if (!valido(c)) {
      console.log(`  ⏭️  descartado (insuficiente): ${c.org || "?"}`);
      continue;
    }
    const clave = claveCentro(c);
    const ex = indice.get(clave);
    if (!ex) {
      if (agregados >= MAX_NUEVOS) {
        console.log("  ⚠️  alcanzado MAX_NUEVOS");
        break;
      }
      const { fuente, ...publico } = c;
      centros.push(publico);
      indice.set(clave, publico);
      agregados++;
      console.log(`  ➕ NUEVO: ${c.org} — ${c.ciudad}, ${c.estado}  [${fuente}]`);
    } else {
      let cambio = false;
      for (const k of ["municipio", "reciben", "tel", "info"])
        if ((!ex[k] || !String(ex[k]).trim()) && c[k]) {
          ex[k] = c[k];
          cambio = true;
        }
      if (ex.lat == null && c.lat != null) (ex.lat = c.lat), (cambio = true);
      if (ex.lng == null && c.lng != null) (ex.lng = c.lng), (cambio = true);
      if (cambio) {
        enriquecidos++;
        console.log(`  ✨ enriquecido: ${ex.org} — ${ex.ciudad}`);
      }
    }
  }

  if (agregados === 0 && enriquecidos === 0) {
    console.log("✅ Sin cambios.");
    return;
  }
  db.centros = centros;
  db.actualizado = hoyISO();
  writeFileSync(RUTA, JSON.stringify(db, null, 2) + "\n", "utf8");
  console.log(`✅ ${agregados} nuevos, ${enriquecidos} enriquecidos. Total: ${centros.length}`);
})();
