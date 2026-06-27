#!/bin/zsh
# Wrapper del agente LOCAL: investiga con Claude Code y publica los cambios.
# Pensado para ejecutarse cada hora vía launchd (en segundo plano).

set -u
REPO="/Users/lucasrivas/Downloads/centros-acopio-vzla"
LOG="$REPO/scripts/agente.log"

# PATH explícito (launchd no hereda tu shell interactivo)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin"

# Marca de tiempo en UTC
ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

cd "$REPO" || { echo "$(ts) ❌ no existe $REPO" >>"$LOG"; exit 1; }

{
  echo "──────── $(ts) inicio ────────"

  # Traer cambios remotos para evitar conflictos
  git pull --rebase --quiet origin main 2>&1 || echo "aviso: git pull falló (sigo)"

  # Investigar y actualizar el JSON
  node scripts/investigar-local.mjs 2>&1
  RES=$?

  if [ $RES -ne 0 ]; then
    echo "$(ts) ⚠️ el agente terminó con código $RES"
  fi

  # Publicar solo si cambió el JSON
  if [ -n "$(git status --porcelain data/centros.json)" ]; then
    git add data/centros.json
    git -c user.email="actions@local" -c user.name="Agente Acopio (local)" \
      commit -q -m "auto: actualización local de centros ($(ts))"
    if git push --quiet origin main; then
      echo "$(ts) ✅ cambios publicados"
    else
      echo "$(ts) ❌ git push falló"
    fi
  else
    echo "$(ts) sin cambios; nada que publicar"
  fi

  echo "──────── $(ts) fin ────────"
  echo ""
} >>"$LOG" 2>&1
