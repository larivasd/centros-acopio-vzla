# Centros de Acopio Venezuela — Terremoto 24 de junio 2026

Sitio informativo con centros de acopio para ayuda tras los terremotos del 24/06/2026.

🌐 **En línea:** https://larivasd.github.io/centros-acopio-vzla/

> ⚠️ Los centros pueden cambiar de horario y necesidades rápidamente.
> Confirma horario y qué están recibiendo antes de acudir o donar.

## Estructura

| Archivo | Qué es |
|---------|--------|
| `index.html` | La página. Lee los datos con `fetch()` desde el JSON. **No se edita para actualizar datos.** |
| `data/centros.json` | **Fuente de verdad** de los centros. Aquí se agrega/edita la información. |
| `scripts/investigar.mjs` | Agente que investiga centros nuevos con IA + búsqueda web. |
| `.github/workflows/actualizar.yml` | Corre el agente **cada hora** y publica los cambios solo. |

## Agente automático

Cada hora, un GitHub Action ejecuta el agente, que:

1. Busca en la web (prensa, sitios oficiales, posts públicos de X/Instagram indexados) centros de acopio nuevos o datos faltantes.
2. Valida y deduplica de forma **conservadora**: solo agrega centros con fuente verificable y datos suficientes; **nunca borra** los existentes.
3. Si hay cambios, hace commit de `data/centros.json` y el sitio se actualiza solo (~1 min).

### Activación

El agente necesita una API key de Claude guardada como secret:

1. Obtén una key en https://console.anthropic.com (menú **API Keys**).
2. En este repo: **Settings → Secrets and variables → Actions → New repository secret**.
3. Nombre: `ANTHROPIC_API_KEY` · Valor: tu key (`sk-ant-...`).

Sin el secret, el agente queda inactivo (no falla, simplemente no hace nada).

### Probarlo a mano

En la pestaña **Actions** del repo → workflow «Actualizar centros de acopio» → **Run workflow**.

## Actualización manual

Edita `data/centros.json` (o usa el formulario «Registrar un centro» de la página, que genera el bloque JSON listo para pegar) y haz commit. El sitio se actualiza automáticamente.
