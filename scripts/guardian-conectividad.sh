#!/bin/bash
# Guardián de modela-simulador.github.io/conectividad (corre por cron en la Mac mini).
# Los push a la rama main publican Pages sin /conectividad (deploy clásico por rama);
# nuestro workflow (feature/nextjs-app) publica el sitio FUSIONADO (main + Next).
# Si /conectividad deja de responder 200, re-dispara el workflow y en ~4 min se repone.
LOG="$HOME/Library/Logs/guardian-conectividad.log"
STAMP="/tmp/guardian-conectividad.last"
URL="https://modela-simulador.github.io/conectividad/"

code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$URL")
[ "$code" = "200" ] && exit 0

# anti doble disparo: no repetir si ya se disparó hace menos de 12 min
now=$(date +%s)
last=$(cat "$STAMP" 2>/dev/null || echo 0)
[ $((now - last)) -lt 720 ] && exit 0

TOKEN=$(printf "protocol=https\nhost=github.com\n" | git credential fill 2>/dev/null | grep '^password=' | cut -d= -f2)
[ -z "$TOKEN" ] && { echo "$(date '+%F %T') sin token (code=$code)" >> "$LOG"; exit 1; }

http=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  -H "Authorization: token $TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/modela-simulador/modela-simulador.github.io/actions/workflows/deploy.yml/dispatches" \
  -d '{"ref":"feature/nextjs-app"}')
echo "$now" > "$STAMP"
echo "$(date '+%F %T') /conectividad=$code -> dispatch=$http" >> "$LOG"
