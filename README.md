# Centros de Acopio Venezuela — Terremoto 24 de junio 2026

Sitio informativo con centros de acopio para ayuda tras los terremotos del 24/06/2026.

🌐 **En línea:** https://centros-acopio-vzla.com

> ⚠️ Los centros pueden cambiar de horario y necesidades rápidamente.
> Confirma horario y qué están recibiendo antes de acudir o donar.

## Estructura

| Archivo | Qué es |
|---------|--------|
| `index.html` | La página. Lee los datos con `fetch()` desde el JSON. **No se edita para actualizar datos.** |
| `data/centros.json` | **Fuente de verdad** de los centros. Aquí se agrega/edita la información. |
| `scripts/investigar-local.mjs` | Agente que investiga centros nuevos usando Claude Code + búsqueda web. |
| `scripts/run-local.sh` | Wrapper: corre el agente y publica los cambios (commit + push). |
| `scripts/com.acopio.agente-local.plist` | Lanzador `launchd` que ejecuta el agente **cada hora** en segundo plano. |

## Agente local (en la Mac)

El agente corre en la máquina del autor con `launchd`, cada hora, usando la sesión
de **Claude Code ya autenticada** (no necesita API key de pago). En cada corrida:

1. Busca en la web (prensa, sitios oficiales, posts públicos de X/Instagram indexados) centros nuevos o datos faltantes.
2. Valida y deduplica de forma **conservadora**: solo agrega centros con fuente verificable y datos suficientes; **nunca borra** los existentes.
3. Si hay cambios, hace commit de `data/centros.json` y el sitio se actualiza solo (~1 min).

### Instalación del lanzador

```sh
cp scripts/com.acopio.agente-local.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.acopio.agente-local.plist
```

Quitar:

```sh
launchctl bootout gui/$(id -u)/com.acopio.agente-local
```

Correr a mano una vez (para probar):

```sh
launchctl kickstart -k gui/$(id -u)/com.acopio.agente-local
# o directamente:
zsh scripts/run-local.sh
```

El registro de actividad queda en `scripts/agente.log`.

> Nota: el agente solo corre cuando la Mac está encendida (si está dormida, corre al despertar).

## Actualización manual

Edita `data/centros.json` (o usa el formulario «Registrar un centro» de la página, que genera el bloque JSON listo para pegar) y haz commit. El sitio se actualiza automáticamente.
