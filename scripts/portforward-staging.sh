#!/usr/bin/env bash
# Port-forward do linkd em staging para localhost:9999.
#
# Uso:
#   ./portforward-staging.sh           # usa contexto stg.k8s.multpex.com.br
#   KCTX=outro ./portforward-staging.sh
#
# Requer:
#   - kubectl com contexto `stg.k8s.multpex.com.br` configurado
#   - acesso ao namespace `linkd`
set -euo pipefail

KCTX="${KCTX:-stg.k8s.multpex.com.br}"
NS="${NS:-linkd}"
PORT="${PORT:-9999}"
DEPLOY="${DEPLOY:-deploy/linkd}"

echo "[portforward-staging] context=${KCTX} ns=${NS} target=${DEPLOY} port=${PORT}"
echo "[portforward-staging] Ctrl+C para encerrar"
exec kubectl --context="${KCTX}" -n "${NS}" port-forward "${DEPLOY}" "${PORT}:${PORT}"
