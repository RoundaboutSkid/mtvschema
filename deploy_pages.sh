#!/bin/zsh
# Publicera schemat till Cloudflare Pages (https://mtvschema.pages.dev).
#
# Gör hela kedjan i ett svep:
#   1. bygger om HTML-sidan från datafilerna
#   2. lägger den i en deploy-mapp (som index.html + medeltidsveckan_schema.html)
#   3. deployar mappen till Pages-projektet "mtvschema"
#
# Användning:  ./deploy_pages.sh            (bygg + publicera)
#              ./deploy_pages.sh --no-build (publicera senaste bygget som det är)
#
# OBS: Workern (kalender-prenumerationen) deployas separat med
#      `cd worker && npx wrangler deploy` – det behövs bara när programdatan
#      eller worker-koden ändrats.

set -e
cd "$(dirname "$0")"

PYTHON="/Library/Frameworks/Python.framework/Versions/3.14/bin/python3"
SRC="medeltidsveckan_output/medeltidsveckan_schema.html"
STAGE=".pages_deploy"          # fast mapp i projektet (gitignorerad), inte /tmp
PROJECT="mtvschema"

if [[ "$1" != "--no-build" ]]; then
  echo "== Bygger om schemat =="
  "$PYTHON" build_schedule.py --no-excel
fi

if [[ ! -f "$SRC" ]]; then
  echo "FEL: $SRC saknas - kör utan --no-build eller bygg först." >&2
  exit 1
fi

echo "== Förbereder deploy-mapp ($STAGE) =="
mkdir -p "$STAGE"
cp "$SRC" "$STAGE/index.html"
cp "$SRC" "$STAGE/medeltidsveckan_schema.html"

echo "== Deployar till Cloudflare Pages ($PROJECT) =="
cd worker   # wrangler är installerad här
npx wrangler pages deploy "../$STAGE" --project-name "$PROJECT" --commit-dirty=true

echo ""
echo "Klart! Kontrollera: https://mtvschema.pages.dev"
echo "(Produktionsdomänen uppdateras direkt; slump-adressen i utskriften ovan"
echo " är bara en permanent förhandslänk för just denna deploy.)"
