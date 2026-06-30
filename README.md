# Centros de Acopio Venezuela — Terremoto 24 de junio 2026

Directorio público de centros de acopio para ayudar a las personas afectadas por los
terremotos del 24/06/2026 en Venezuela (magnitudes 7,2 y 7,5). Incluye centros **dentro
de Venezuela** y puntos de recolección de la **diáspora venezolana en el exterior**.

- 🌐 **Sitio:** https://centros-acopio-vzla.com
- 🔌 **API pública:** https://centros-acopio-vzla.com/data/centros.json
- 📖 **Docs API:** https://centros-acopio-vzla.com/desarrolladores.html

> ⚠️ Las necesidades y horarios cambian rápido. Confirma antes de acudir o donar.

---

## 1. Qué es y cómo funciona (resumen)

Es un **sitio 100% estático** alojado en **GitHub Pages** con dominio propio y HTTPS.
No hay servidor ni base de datos: toda la información vive en un único archivo JSON
(`data/centros.json`) que el sitio lee con `fetch()` y que también funciona como **API pública**.

La información se mantiene mediante **agentes de IA** (Claude Code en modo headless, con
búsqueda web) que investigan fuentes públicas, validan, deduplican, geocodifican y publican
los cambios. **El proceso es manual** (se ejecuta cuando se desea); no hay tarea programada.

```
Agentes (búsqueda web) → fusión conservadora → normalización → geocodificación
        → commit/push a GitHub → GitHub Pages publica (~1 min) → sitio + API actualizados
```

---

## 2. Estructura del repositorio

| Archivo | Qué es |
|---------|--------|
| `index.html` | El sitio: filtros (país → estado → ciudad), mapa (Leaflet), tarjetas, "Centros cerca de mí" (geolocalización). Lee los datos por `fetch()`. |
| `data/centros.json` | **Fuente de verdad.** Todo el directorio. Es también el endpoint de la API. |
| `desarrolladores.html` | Documentación de la API pública (endpoint, esquema, ejemplos cURL/JS/Python). |
| `CNAME` | Dominio personalizado para GitHub Pages (`centros-acopio-vzla.com`). |
| `scripts/investigar-paralelo.mjs` | **Agente principal:** lanza varios agentes en paralelo (uno por región), fusiona y deja un informe. |
| `scripts/investigar-local.mjs` | Agente alternativo de un solo proceso con rotación de región por hora. |
| `scripts/fusionar.mjs` | Fusiona archivos JSON de candidatos dentro de `data/centros.json` (dedup conservador). |
| `scripts/normalizar.mjs` | Canonicaliza país/estado mal escritos y elimina duplicados exactos. |
| `scripts/geocodificar.mjs` | Añade `lat`/`lng` a los centros sin coordenadas (OpenStreetMap / Nominatim). |
| `scripts/afinar-gps.mjs` | Mantenimiento: reubica direcciones con número de calle a su punto exacto. |
| `scripts/afinar-landmarks.mjs` | Mantenimiento: reubica los que quedaron en el centro de la ciudad a su barrio/landmark. |
| `scripts/run-local.sh` | Orquestador del ciclo completo (investigar → normalizar → geocodificar → commit/push). |
| `scripts/com.acopio.agente-local.plist` | Plantilla de `launchd` (opcional) por si se quiere reactivar la ejecución automática. |

Ignorados por git (`.gitignore`): `scripts/agente.log`, logs de launchd y `scripts/informes/`.

---

## 3. El dato (`data/centros.json`)

```json
{
  "actualizado": "2026-06-30",
  "fuente": "Directorios ciudadanos y medios ...",
  "centros": [
    {
      "pais": "Venezuela",
      "org": "Comando Con Venezuela",
      "estado": "Barinas",
      "ciudad": "Barinas",
      "municipio": "Barinas",
      "dir": "Av. Marqués del Pumar, ...",
      "reciben": "Agua, alimentos, insumos médicos, ropa",
      "tel": "",
      "info": "",
      "lat": 8.625737,
      "lng": -70.217709
    }
  ]
}
```

Campos obligatorios para que un centro sea válido: `pais`, `org`, `ciudad`, `dir`.
`lat`/`lng` pueden ser `null` (entonces no aparece en el mapa, pero sí en la lista).

---

## 4. El sitio (`index.html`)

- **Filtros encadenados:** país → estado/región → ciudad → municipio + búsqueda por texto.
- **Mapa** (Leaflet + OpenStreetMap) con un marcador por centro georreferenciado.
- **Centros cerca de mí:** usa la geolocalización del navegador (con permiso), ordena por
  distancia (fórmula Haversine) y muestra los km en cada tarjeta. La ubicación se calcula
  en el navegador; no se envía a ningún lado.
- **Tarjetas** con enlace "Ver en mapa" (Google Maps), llamar y más info.
- El público **no registra** centros: solo se publica información verificable.

---

## 5. La API pública

`GET https://centros-acopio-vzla.com/data/centros.json`

- Gratis, sin API key, **CORS abierto** (`access-control-allow-origin: *`), formato JSON.
- Devuelve todo el listado en una sola petición. Caché ~10 min.
- Documentación y ejemplos: `desarrolladores.html`.

---

## 6. Los agentes / pipeline de actualización

### Requisitos
- [Node.js](https://nodejs.org) 18+ (usa `fetch` global).
- [Claude Code](https://claude.com/claude-code) instalado y **con sesión iniciada**
  (los agentes usan `claude -p` en modo headless; no requiere API key de pago aparte).
- `git` y `gh` (GitHub CLI) autenticado para poder publicar (`gh auth setup-git`).

### Cómo se investiga (modo conservador)
Cada agente busca en la web centros **nuevos** por región, y solo agrega los que tienen
**fuente pública verificable** y datos suficientes. **Nunca borra** centros existentes;
solo agrega o rellena campos vacíos. Hay deduplicación por `país|org|ciudad|dir`.

### Regiones del barrido paralelo
Venezuela · Norteamérica · Centroamérica · Caribe · Andina · Cono Sur ·
Europa sur/oeste · Europa centro/norte.

### Geocodificación
Se usa **Nominatim (OpenStreetMap)**, gratis, respetando su límite (~1 petición/seg).
Intenta primero la dirección de calle limpia y, si no, cae a nivel de ciudad.

---

## 7. Cómo ejecutar la actualización (MANUAL)

> La ejecución automática (cron) está **desactivada** para ahorrar consumo.
> Se corre a mano cuando se quiera actualizar.

### Opción A — ciclo completo (recomendado)
Hace todo (investigar en paralelo → normalizar → geocodificar → publicar) y deja un informe:

```sh
cd /Users/lucasrivas/Downloads/centros-acopio-vzla
zsh scripts/run-local.sh
# Resultado y registro en: scripts/agente.log
# Informe de la corrida en:  scripts/informes/ULTIMO.md
```

### Opción B — pasos sueltos
```sh
node scripts/investigar-paralelo.mjs   # 8 agentes en paralelo + informe
node scripts/normalizar.mjs            # corrige país/estado y dedup
node scripts/geocodificar.mjs          # coordenadas a los que falten
# luego publicar:
git add data/centros.json && git commit -m "data: actualización manual" && git push
```

### Búsqueda dirigida a una región/país concreto
```sh
FOCO="estado Nueva Esparta, Venezuela" node scripts/investigar-local.mjs
node scripts/geocodificar.mjs
git add -A && git commit -m "data: Nueva Esparta" && git push
```

### Mantenimiento de precisión GPS (ocasional)
```sh
node scripts/afinar-gps.mjs        # afina direcciones con número de calle
node scripts/afinar-landmarks.mjs  # afina los que están en el centro de la ciudad
git add -A && git commit -m "fix(gps): afinado" && git push
```

### Agregar / corregir un centro a mano
Edita `data/centros.json`, luego:
```sh
node scripts/geocodificar.mjs   # si quedó sin lat/lng
git add data/centros.json && git commit -m "data: nuevo centro" && git push
```

---

## 8. (Opcional) Reactivar la ejecución automática

Si en el futuro se quiere que corra solo otra vez (vía `launchd` en macOS):

```sh
cp scripts/com.acopio.agente-local.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.acopio.agente-local.plist
# Quitarlo de nuevo:
launchctl bootout gui/$(id -u)/com.acopio.agente-local
rm ~/Library/LaunchAgents/com.acopio.agente-local.plist
```

El plist viene configurado para 3 corridas al día (8:00, 12:00 y 18:00). Editar las horas
en el bloque `StartCalendarInterval` si se desea otra frecuencia.

> Nota: la ejecución automática requiere la Mac encendida y la sesión de Claude Code iniciada;
> consume cuota de Claude Code en cada corrida.

---

## 9. Despliegue (GitHub Pages)

- Repositorio público en GitHub; **Pages** sirve desde la rama `main`, carpeta raíz.
- Dominio personalizado vía archivo `CNAME` + registros DNS (4 `A` al apex hacia las IPs de
  GitHub Pages y un `CNAME` `www` → `usuario.github.io`).
- **HTTPS** automático (certificado Let's Encrypt gestionado por GitHub).
- Cada `git push` a `main` redespliega el sitio en ~1 minuto.

---

## 10. Notas y limitaciones

- Algunas coordenadas son **aproximadas** (a nivel de barrio o ciudad) cuando la dirección
  no es exacta. La tarjeta siempre muestra la dirección escrita y el botón "Ver en mapa".
- La calidad depende de las fuentes públicas; por eso el modo es **conservador** (mejor pocos
  pero verificables) y el aviso "confirma antes de ir" es permanente.
