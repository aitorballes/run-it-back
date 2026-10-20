#!/bin/zsh
# Despliega las Edge Functions en Supabase. La importación usa los mismos módulos que la web:
# se copian a supabase/functions/_shared (no versionado) justo antes de desplegar, así que hay
# que volver a ejecutar esto cada vez que cambien parser.js, handUtils.js o importer.js.
#
# La primera vez: npx supabase login
set -e
root=${0:A:h:h}
shared=$root/supabase/functions/_shared
mkdir -p $shared
cp $root/src/lib/parser.js $root/src/lib/handUtils.js $root/src/lib/importer.js $shared/
cd $root
npx --yes supabase functions deploy import-hand-histories --project-ref wbpqojhcltmlkdcbfgzu
