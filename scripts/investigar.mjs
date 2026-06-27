#!/usr/bin/env node
/**
 * Agente de investigación de centros de acopio (Venezuela, terremoto 24/06/2026).
 *
 * Qué hace:
 *  1. Lee data/centros.json (fuente de verdad actual).
 *  2. Pide a Claude (con búsqueda web) que encuentre centros NUEVOS o datos
 *     que falten de los existentes, en fuentes públicas (web, prensa, y posts
 *     de X/Instagram que estén indexados).
 *  3. Valida, deduplica y MERGEA de forma CONSERVADORA:
 *       - Solo AGREGA centros nuevos bien formados y con fuente.
 *       - ENRIQUECE campos vacíos de centros existentes (tel, info, GPS).
 *       - NUNCA borra centros existentes.
 *  4. Si hubo cambios, reescribe data/centros.json. El commit/push lo hace
 *     el workflow de GitHub Actions.
 *
 * Variables de entorno:
 *   ANTHROPIC_API_KEY  (obligatoria)
 *   MODELO             (opcional, por defecto claude-sonnet-4-6)
 *   MAX_NUEVOS         (opcional, tope de centros nuevos por corrida, def. 25)
 */

import { readFileSync, writeFileSync } from "node:fs";

const RUTA = "data/centros.json";
const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODELO = process.env.MODELO || "claude-sonnet-4-6";
const MAX_NUEVOS = parseInt(process.env.MAX_NUEVOS || "25", 10);

if (!API_KEY) {
  console.warn(
    "⏸️  Falta el secret ANTHROPIC_API_KEY. El agente queda inactivo (sin error). " +
      "Agrega el secret en Settings → Secrets and variables → Actions para activarlo."
  );
  process.exit(0); // salir OK para no marcar la corrida como fallida
}

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

function hoyISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

// --- 1. cargar datos actuales ---
const db = JSON.parse(readFileSync(RUTA, "utf8"));
const centros = Array.isArray(db.centros) ? db.centros : [];
const indice = new Map(centros.map((c) => [claveCentro(c), c]));

console.log(`📂 Centros actuales: ${centros.length}`);

// lista compacta para que el modelo evite duplicados (ahorra tokens)
const listaExistente = centros
  .map((c) => `- ${c.org} | ${c.dir} (${c.ciudad}, ${c.estado})`)
  .join("\n");

// --- 2. prompt al agente ---
const PROMPT = `Eres un investigador que mantiene actualizado un directorio público de CENTROS DE ACOPIO en Venezuela para ayudar a las víctimas de los terremotos del 24 de junio de 2026 (magnitudes 7,2 y 7,5).

TU TAREA: usar la búsqueda web para encontrar centros de acopio NUEVOS (que NO estén ya en la lista de abajo) y datos de contacto/ubicación que falten. Busca en prensa venezolana, sitios oficiales, y publicaciones públicas de X (Twitter) e Instagram que aparezcan en los resultados de búsqueda. Cubre todos los estados afectados.

REGLAS ESTRICTAS (modo conservador — la información manda gente a lugares físicos):
1. Solo incluye un centro si tienes una FUENTE pública verificable (URL) y datos suficientes: organización, estado, ciudad y dirección. Si dudas, NO lo incluyas.
2. NO inventes direcciones, teléfonos ni coordenadas. Si no encuentras un dato, ponlo como cadena vacía "" (o null para lat/lng).
3. NO repitas centros que ya están en la lista existente.
4. Prioriza información reciente y de fuentes confiables.

Devuelve EXCLUSIVAMENTE un objeto JSON (sin texto adicional, sin markdown) con esta forma exacta:
{
  "centros": [
    {
      "org": "string",
      "estado": "string",
      "ciudad": "string",
      "municipio": "string",
      "dir": "string",
      "reciben": "string",
      "tel": "string",
      "info": "string (URL de Instagram/web del centro, o vacío)",
      "lat": number|null,
      "lng": number|null,
      "fuente": "string (URL de DÓNDE obtuviste la información)"
    }
  ]
}

Si no encuentras nada nuevo confiable, devuelve {"centros": []}.

LISTA EXISTENTE (no la repitas):
${listaExistente}`;

// --- 3. llamar a la API de Anthropic con búsqueda web ---
async function consultarAgente() {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: 8000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
      messages: [{ role: "user", content: PROMPT }],
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`API ${resp.status}: ${txt.slice(0, 500)}`);
  }
  const data = await resp.json();
  // concatenar todos los bloques de texto de la respuesta final
  const texto = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return texto;
}

function extraerJSON(texto) {
  // intento directo
  try {
    return JSON.parse(texto);
  } catch {}
  // quitar fences ```json ... ```
  const fence = texto.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {}
  }
  // primer { ... último }
  const i = texto.indexOf("{");
  const j = texto.lastIndexOf("}");
  if (i !== -1 && j !== -1 && j > i) {
    try {
      return JSON.parse(texto.slice(i, j + 1));
    } catch {}
  }
  throw new Error("No se pudo extraer JSON de la respuesta del modelo");
}

// --- 4. validar un candidato ---
function valido(c) {
  if (!c || typeof c !== "object") return false;
  for (const k of ["org", "estado", "ciudad", "dir"]) {
    if (!c[k] || !String(c[k]).trim()) return false;
  }
  if (!c.fuente || !String(c.fuente).trim()) return false; // exige fuente
  if (!esNumOnull(c.lat ?? null) || !esNumOnull(c.lng ?? null)) return false;
  return true;
}

function limpiar(c) {
  const txt = (v) => (v == null ? "" : String(v).trim());
  const num = (v) =>
    v === null || v === undefined || v === "" ? null : Number(v);
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
    console.error("❌ Error llamando al agente:", e.message);
    process.exit(1);
  }

  let parsed;
  try {
    parsed = extraerJSON(texto);
  } catch (e) {
    console.error("❌", e.message);
    console.error("Respuesta cruda:\n", texto.slice(0, 1000));
    process.exit(1);
  }

  const candidatos = Array.isArray(parsed.centros) ? parsed.centros : [];
  console.log(`🔎 Candidatos devueltos por el agente: ${candidatos.length}`);

  let agregados = 0;
  let enriquecidos = 0;

  for (const raw of candidatos) {
    const c = limpiar(raw);
    if (!valido(c)) {
      console.log(`  ⏭️  descartado (datos/fuente insuficientes): ${c.org || "?"}`);
      continue;
    }
    const clave = claveCentro(c);
    const existente = indice.get(clave);

    if (!existente) {
      if (agregados >= MAX_NUEVOS) {
        console.log("  ⚠️  alcanzado MAX_NUEVOS, se ignoran el resto");
        break;
      }
      // guardamos sin el campo fuente en el array público (queda en el log)
      const { fuente, ...publico } = c;
      centros.push(publico);
      indice.set(clave, publico);
      agregados++;
      console.log(`  ➕ NUEVO: ${c.org} — ${c.ciudad}, ${c.estado}  [fuente: ${fuente}]`);
    } else {
      // enriquecer SOLO campos vacíos del existente
      let cambio = false;
      for (const k of ["municipio", "reciben", "tel", "info"]) {
        if ((!existente[k] || !String(existente[k]).trim()) && c[k]) {
          existente[k] = c[k];
          cambio = true;
        }
      }
      if (existente.lat == null && c.lat != null) {
        existente.lat = c.lat;
        cambio = true;
      }
      if (existente.lng == null && c.lng != null) {
        existente.lng = c.lng;
        cambio = true;
      }
      if (cambio) {
        enriquecidos++;
        console.log(`  ✨ enriquecido: ${existente.org} — ${existente.ciudad}`);
      }
    }
  }

  if (agregados === 0 && enriquecidos === 0) {
    console.log("\n✅ Sin cambios. No se escribe nada (no habrá commit).");
    return;
  }

  db.centros = centros;
  db.actualizado = hoyISO();
  writeFileSync(RUTA, JSON.stringify(db, null, 2) + "\n", "utf8");
  console.log(
    `\n✅ Cambios aplicados: ${agregados} nuevos, ${enriquecidos} enriquecidos. Total: ${centros.length}`
  );
})();
