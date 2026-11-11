#!/bin/bash
# uso: medir.sh <py|ts> <dir-salida>
L=$1; S=$2; W=tokalo-prueba-$L; U=https://$W.tokaloperu.workers.dev
cd /home/rodzun/Proyectos/tokalo/prueba/$L
export PATH="$HOME/.virtualenvs/nfc/bin:$PATH" VIRTUAL_ENV="$HOME/.virtualenvs/nfc"
dep() { if [ $L = py ]; then pywrangler deploy >/dev/null 2>&1; else npx wrangler deploy >/dev/null 2>&1; fi; }
req() { curl -s -o /dev/null -w "$1,%{http_code},%{time_total}\n" "$U/n/abc234?t=$1" >> $S/curl-$L.csv; }
tail_on() { (timeout 600 npx wrangler tail $W --format json >> $S/tail-$L-$1.json 2>>$S/tail-$L.err &); sleep 10; }
tail_off() { sleep 6; pkill -f "cli.js tail $W"; sleep 1; }
: > $S/curl-$L.csv; rm -f $S/tail-$L-*.json $S/tail-$L.err
for c in 1 2 3 4 5; do
  dep; tail_on $c
  req frio$c; for i in 1 2 3; do req trasfrio${c}_$i; done
  if [ $c = 5 ]; then
    for i in $(seq 1 80); do req caliente$i; done
    for i in $(seq 1 10); do req rafaga$i & done; wait
  fi
  tail_off
done
