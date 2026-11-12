# Tokalo

Placas NFC + QR que redirigen a la página de reseñas de un negocio.
Dominio: tokaloperu.com (en la cuenta de Cloudflare del dueño).
Subdominio de pruebas: tokaloperu.workers.dev.
El dueño trabaja solo, es backend Python y no sabe frontend.

## Reglas de trabajo

- Antes de cada etapa: mostrar plan y problemas, y esperar aprobación.
- Solo plan gratuito de Cloudflare (Workers + D1). Nada que cueste.
- Explicar cada paso manual que le toque al dueño (login, dominio) y por qué.
- Responder en español, directo y breve.
- Commits pequeños. No desplegar a producción sin avisar.
- Preguntar antes de instalar cualquier herramienta o paquete.
- Las pruebas de carga se hacen solo en la base local (`--local`), nunca contra desarrollo
  ni producción en la nube: el cupo de D1 es por cuenta y agotarlo tumba las redirecciones
  del público.
- Antes de cualquier prueba en la nube con más de 100 solicitudes, estimar las filas que
  va a leer y pedir permiso al dueño.
- Desplegar siempre con `npm run desplegar` o `npm run desplegar:produccion`: aplican
  primero la migración y, si falla, abortan sin subir el código. Nunca `wrangler deploy`
  suelto ni comandos encadenados con `;`. (El 2026-11-11 una migración falló por el cupo y
  el código nuevo se desplegó igual sobre la base vieja en desarrollo.)
- Candado: `npm run desplegar:produccion` y `npm run migrar:produccion` abortan si git
  tiene cambios sin commit, o archivos nuevos sin seguimiento en `src/` o `migrations/`
  (`scripts/candado_despliegue.py`, con tests en `scripts/test_candado_despliegue.py`).
  No saltárselo llamando a `wrangler` directamente contra producción.
- Ningún script de medición despliega a producción, ni la migra. Si hace falta forzar
  arranques en frío en producción, pedirlo al dueño y decidirlo con él.
- No editar el proyecto mientras corre algo que despliega. (El 2026-11-12 un script de
  medición redesplegaba producción mientras se escribía la tabla resumen: la migración
  0007 y código a medio hacer llegaron a producción sin permiso.)
- Toda migración debe ser compatible con el código anterior: añadir columnas o tablas, no
  quitar ni renombrar en el mismo paso. Lo que sobra se elimina en una migración posterior.

## Decisión de lenguaje (paso 0, 2026-11-11)

Todo el Worker en TypeScript (redirección, admin y landing), en un solo Worker.
Python queda solo para scripts locales.

Motivo, medido en workers.dev con ~110 solicitudes por Worker (límite gratuito: 10 ms de CPU):

| CPU por solicitud | Python | TypeScript |
|---|---|---|
| Arranque en frío | 32–47 ms (prom. 37) | 1 ms |
| En caliente | prom. 4,9 · p95 10 · máx 31 | prom. 0,1 · máx 2 |
| Total | prom. 8,6 · p95 35 · máx 47 | prom. 0,2 · máx 2 |
| Por encima de 10 ms | 23 de 109 | 0 de 107 |
| Arranque al desplegar (límite 1000 ms) | 937 ms | 1 ms |

Ninguna solicitud falló (Cloudflare toleró los excesos), pero no está garantizado.

Hash de contraseña, PBKDF2-SHA256 con WebCrypto (CPU promedio, 8 solicitudes cada uno):
10 000 iteraciones 1,9 ms · 25 000 3,5 ms · 50 000 8,8 ms · 100 000 16 ms.
Workers rechaza más de 100 000 iteraciones.

Link oficial de reseña de Google: `https://g.page/r/TOKEN/review`, con TOKEN = base64url
sin relleno de `0x09 + BBBB (uint64 little-endian) + 0x10 0x02`. Redirige a
`search.google.com/local/writereview?placeid=...` con el mismo Place ID que calculamos:
confirma el método y que el link oficial también abre la reseña en el navegador.

Links de Maps compartidos desde iPhone (maps.app.goo.gl/...?g_st=ic): el primer salto
302 trae `ftid=0xAAAA:0xBBBB`, también cuando la petición sale desde Cloudflare.

## Lotes y modelos (etapa 7)

- Lotes: se crean y se eliminan desde `/admin/lotes`. Tope de 500 placas por lote.
  Solo se elimina un lote si ninguna de sus placas fue activada alguna vez.
- El número de lote no se reutiliza (AUTOINCREMENT, migración 0003).
- Modelos: se crean y se eliminan desde `/admin/modelos`. Solo se elimina un modelo sin
  lotes ni placas. No hay edición de modelos.
- CPU medido en desarrollo: crear lote de 500, prom. 3,5 ms (máx. 5); CSV de 500, 3,2 ms.
- Migraciones que recrean una tabla referenciada por otras: probarlas antes en una base
  local CON datos (`wrangler d1 ... --local`). Los tests solo migran bases vacías.

## QR (etapa 8)

- Codificador propio en `src/lib/qr.ts`: modo alfanumérico, corrección M, tamaños 1 a 3
  (hasta 61 caracteres). Cero dependencias de producción.
- `qrcode-generator` queda solo como devDependency: los tests comparan cuadro por cuadro
  nuestro QR con el suyo. No usarla en producción: gastaba prom. 10,4 ms de CPU (máx. 33).
- CPU medido en desarrollo (30 solicitudes, QR de 29x29): prom. 3,4 ms, p50 3, máx. 10
  (la primera tras desplegar). En producción el QR es de 25x25, algo más barato.
- Lección: en Workers el código casi siempre corre "en frío" (sin optimizar por el motor).
  Los bucles pesados cuestan 5 a 10 veces más que en una prueba local repetida; medir
  siempre desplegado, no en local.
- Un QR por solicitud (`/admin/placas/CODIGO/qr.svg`); no hay descarga masiva.

## Conversión de links de Maps (etapa 9)

- `src/lib/maps.ts`. Orden: link que ya es de reseña -> par `0xAAAA:0xBBBB` (en `ftid=` o
  `!1s`) -> `cid=` (link oficial g.page) -> "no se pudo" (se pide a mano).
- Solo sigue redirecciones de links cortos de Google, a mano, máximo 3 saltos, solo https
  y solo hacia dominios de Google.
- Página `/admin/convertir` para probar un link; el formulario de activación la reutiliza.
- Verificado contra Google real desde local y desde Cloudflare con los tres links de
  iPhone. Links compartidos desde Android: PENDIENTE (el dueño no tenía uno a mano).
- CPU medido en desarrollo: prom. 2,1 ms (máx. 7).
- Destino elegido: link de reseña directo (`writereview?placeid=`). El dueño probó en
  iPhone: el directo y el oficial g.page funcionan igual; la ficha de Maps obliga a más
  pasos y se descartó. Android: pendiente de probar.

## Activación (etapa 10)

- `/admin/placas/CODIGO`: formulario si está sin activar; ficha si está activa o desactivada.
- Dos pasos en un mismo formulario: "Revisar link" (convierte y muestra el destino con
  "Probar", sin guardar) y "Activar placa" (solo aparece tras revisar). Si el link se
  cambia después de revisarlo, obliga a revisar otra vez.
- Si no se puede convertir, se pide el link de reseña a mano (cualquier https; así entra
  Tripadvisor). Todo destino guardado debe ser https.
- CPU medido en desarrollo (una muestra de cada uno): formulario 5 ms, revisar 6 ms,
  activar 3 ms, ficha 4 ms.

## Plataformas (etapa 11, pedido del dueño)

- Cada modelo es de una plataforma (columna `modelos.plataforma`, migración 0004): google,
  tripadvisor, instagram, facebook, tiktok u otra. Un "Tótem pavonado" de Google y otro de
  Instagram son modelos distintos, con ids distintos. Los modelos D a H son de Google.
- La lista de plataformas y sus dominios está en `src/lib/plataformas.ts`; añadir una es
  editar ese archivo.
- Activación según plataforma: Google convierte el link de Maps; las demás usan el link
  del negocio tal cual (https obligatorio).
- Si el destino no es del dominio de la plataforma del modelo, se AVISA pero no se bloquea;
  queda marcado en la ficha y en la lista, y hay un filtro para ver solo esos.

## Lista de placas y cambios (etapa 11)

- `/admin/placas`: una tarjeta por placa con estado, negocio, destino, modelo, plataforma
  y escaneos (total, 30 días, NFC, QR). Filtros por estado, plataforma, texto y "destino
  que no es de su plataforma". De 50 en 50.
- Ficha: cambiar destino (mismo flujo revisar/probar/guardar; anota historial), editar
  datos del negocio, desactivar (con confirmación) y reactivar. Historial visible.
- Desactivar y reactivar no quedan registrados en ningún historial.
- CPU medido en desarrollo con 509 placas y 20 000 escaneos (6 solicitudes de cada una):
  lista prom. 4,2 ms (máx. 8); página 3 filtrada 4,3 (máx. 9); búsqueda 3,3; filtro "no
  coinciden" 6,3 (máx. 8); ficha 2,3.
- El filtro "no coinciden" lee todos los destinos y filtra en el Worker: su costo crece con
  el número de placas activadas. Revisarlo si se pasa de unos pocos miles.

## Reportes (etapa 12)

- `/admin/reportes/escaneos`: lecturas por placa separadas en NFC y QR, con totales.
- `/admin/reportes/activaciones`: placas activadas por día, semana (lunes a domingo), mes o
  placa por placa; opcionalmente separadas por usuario. Filtros por rango, usuario y
  plataforma.
- Fechas y agrupaciones en hora de Perú. Descarga CSV con `?formato=csv`.
- "Activación" = primera activación (`placas.activada_en`). Reactivar no suma.
- Tope de 200 filas en pantalla y 500 en CSV; los totales son siempre de todo el rango.
- CPU medido en desarrollo con 509 placas, 20 000 escaneos y rango de 4 meses (8
  solicitudes de cada una): escaneos prom. 5,6 ms (máx. 11); escaneos CSV 3,4 (máx. 6);
  activaciones por día y usuario 4,5 (máx. 12); detalle 5,8 (máx. 9); detalle CSV 6,6
  (máx. 10). Con 500 filas en pantalla el detalle daba prom. 8 (máx. 11), por eso el tope.
  Si los picos molestan, bajar `MAX_FILAS` en `src/lib/reportes.ts`.

## Respaldo (etapa 13)

- `npm run respaldar` (o `python3 scripts/respaldar.py dev`) exporta la base a
  `respaldos/BASE-FECHA.sql`, carpeta ignorada por git (datos de clientes).
- El script reordena el archivo de Cloudflare (todos los CREATE TABLE primero): tal como
  sale de `wrangler d1 export` NO se puede restaurar, porque crea `placas` antes que `lotes`.
- Restauración probada el 2026-11-11: respaldo de producción cargado en una base local
  vacía, con las mismas cuentas de filas y sin errores de claves foráneas.
- D1 Time Travel: siempre activo, sin costo, 7 días de historial en el plan gratuito.
- Pendiente del dueño: probar QR, chip y link de reseña en Android, y un link de Maps
  compartido desde Android.

## Límite diario de lecturas de D1 (incidente del 2026-11-11)

- El plan gratuito de D1 permite 5 millones de filas leídas al día POR CUENTA (desarrollo
  y producción comparten el cupo). Al pasarlo, toda lectura falla hasta la medianoche UTC
  (19:00 de Lima): las placas activas mandan a la landing y el admin muestra la página
  de respaldo. No genera cobros.
- El 2026-11-11 se agotó por las pruebas de carga de las etapas 11 y 12: cada vista de
  reporte sobre 20 000 escaneos lee unas 60 000 a 120 000 filas (el JOIN cuenta cada
  tabla), y se hicieron decenas de vistas.
- Riesgo del producto: con muchos escaneos, unas pocas decenas de vistas de reportes al
  día pueden agotar el cupo y tumbar las redirecciones. Pendiente de decidir con el dueño
  (tabla resumen diaria, o límites en los reportes).
- `wrangler tail NOMBRE --env X` añade el entorno al nombre: para producción usar
  `npx wrangler tail tokalo` (sin `--env`).
- Medición de /n y /q en producción con placa activa (2026-11-12, 90 solicitudes, 76
  capturadas, 5 redespliegues): en frío prom. 2,3 ms de CPU (máx. 3); en caliente prom.
  0,9 (máx. 4); ninguna sobre 10 ms. La placa, el lote y los escaneos de prueba se borraron.

## Tablas resumen de escaneos (migraciones 0007 y 0008)

- `escaneos_diarios` (placa, día de Perú, canal, cantidad) y `escaneos_totales` (placa,
  canal, cantidad). Cada escaneo suma 1 en ambas dentro de la misma transacción en que se
  guarda (`sentenciasDeEscaneo` en `src/lib/escaneos.ts`).
- El reporte de escaneos y la lista de placas leen SOLO de los resúmenes. `escaneos` queda
  como detalle (país, sistema). Rango máximo de los reportes: 366 días (`MAX_DIAS`).
- Filas leídas, medido en local con 550 placas y 40 000 escaneos (21 500 filas diarias):
  reporte de 4 meses 280 550 -> 24 450; de 30 días 245 550 -> 18 950; lista 15 775 -> 2 885.
- Filas escritas por escaneo: 5 (antes 3). Bajará a 4 al quitar el índice `escaneos_fecha`,
  que ya nadie usa: va en una migración posterior, cuando este código esté desplegado.
- Lección: en D1 un GROUP BY que necesita ordenar aparte ("TEMP B-TREE") cuenta el doble de
  filas leídas. El reporte recorre `placas` y entra a `escaneos_diarios` por su clave
  primaria para evitarlo. Revisar con EXPLAIN QUERY PLAN al tocar esa consulta.
- Tras desplegar, comprobar que `SELECT SUM(cantidad)` de cada resumen es igual a
  `SELECT COUNT(*) FROM escaneos`. Si no, repetir las sentencias de relleno de la 0008.
- CPU medido en desarrollo el 2026-11-12 (64 solicitudes, base pequeña: 9 placas y 33
  escaneos): escaneo prom. 1,1 ms (máx. 3; 3 en frío); lista 1,6 (máx. 3); reporte 1,4
  (máx. 3; 5 en frío); CSV 1,0; ficha 1,5. Con muchos datos NO está medido desplegado: las
  pruebas de carga en la nube están prohibidas.
- Esquema comparado el 2026-11-12: las dos tablas de producción son idénticas a las de una
  base local limpia; solo sobra el índice `escaneos_diarios_dia`, que la 0008 elimina. La
  0007 no cambió después de aplicarse en producción. No hace falta una 0009.
- Estado al 2026-11-12: desarrollo tiene 0007, 0008 y el código. Producción tiene solo la
  0007 (aplicada por error; el código desplegado no usa las tablas). Subir a producción
  requiere permiso del dueño y respaldo previo.

## Admin: presentación de datos (pedidos del dueño)

- En la base las fechas van en UTC; en el admin se muestran en hora de Perú (UTC-5).
- Lista de placas en una sola tabla, con el destino de cada una a la vista, para detectar
  de un vistazo destinos raros (el link manual permite cualquier https).
- Reporte de escaneos por código y canal (lecturas `n` y `q`).
- Reporte de activaciones agrupable por día, semana o mes y por usuario, con filtros.

## Condiciones para el código

- Pocas dependencias, sin frameworks grandes. Justificar cada una.
- TypeScript estricto, código simple y comentado en español (el dueño lo lee viniendo de Python).
- Frontend: HTML y CSS simples servidos por el Worker. Sin React ni build pesado.
- Datos en D1, siempre con migraciones.
- No guardar DNI, IP ni user-agent completo.
- Nunca un error 500 al público.

## Login y sesión (aprobado 2026-11-11)

- Usuario y contraseña propios. PBKDF2-SHA256 con 20 000 iteraciones (decisión del dueño;
  empezó en 25 000 y un login de 24 llegó a 11 ms de CPU); el número va
  guardado dentro del hash (`pbkdf2$iteraciones$sal$hash`) para poder subirlo.
- Contraseñas generadas por `scripts/crear_usuario.py`, no elegidas por la persona.
- Cookie firmada, 30 días, `Secure; HttpOnly; SameSite=Lax; Path=/`. Debe enviarse cuando
  el navegador se abre desde un toque NFC o un QR (navegación iniciada fuera del sitio).
- En cada solicitud con cookie se comprueba en la base que el usuario siga activo.
- Límite de intentos: 5 fallos bloquean 15 minutos.
- Los escaneos hechos con sesión no se registran en estadísticas.
- CPU medido del login completo en desarrollo (12 solicitudes de cada tipo): login
  correcto prom. 5,6 ms (máx. 8); login fallido prom. 6,0 ms (máx. 11); página del admin
  con cookie 0,4 ms; escaneo con sesión 1,0 ms; escaneo público 0,8 ms.
- Con sesión, /n y /q redirigen a `/admin/placas/CODIGO`, que muestra formulario o ficha.
- Secreto `SECRETO_SESION` subido a ambos entornos con `wrangler secret put` (no está en
  ningún archivo; en local, `.dev.vars`, ignorado por git).
- Usuarios: `python3 scripts/crear_usuario.py dev|produccion --usuario X --nombre "Y"`.
  Lo ejecuta el dueño en su terminal, para que la contraseña solo la vea él.
- Placa desactivada: al público lo manda a la landing; con sesión muestra la ficha con
  botón para reactivarla, conservando sus datos.

## Etapas de la fase 1

1. Esqueleto (TypeScript estricto, tests, Worker de desarrollo en workers.dev).
2. Base: migraciones, catálogo D–H, datos de prueba.
3. Redirección pública y landing.
4. Conectar tokaloperu.com (los registros A de Spaceship ya están borrados).
5. Estadísticas.
6. Login.
7. Códigos y lotes.
8. QR en SVG (se prueba con la URL real).
9. Conversión de Maps.
10. Activación (hecha).
11. Lista de placas con su destino, cambiar destino (con historial), desactivar y reactivar,
    y plataforma por modelo (hecha).
12. Reportes: escaneos por código y canal; activaciones por día/semana/mes y por usuario,
    con filtros (hecha).
13. README y respaldo (hecha). Fase 1 completa.

Desde la etapa 4 hay dos entornos: desarrollo (workers.dev) y producción (tokaloperu.com).
Cada etapa se despliega primero a desarrollo; a producción solo con aviso previo.

## Códigos de placa

- 6 caracteres. Alfabeto de 28: consonantes sin L (BCDFGHJKMNPQRSTVWXYZ) y dígitos 2–9.
  Sin vocales, para que nunca se formen palabras.
- Aleatoriedad criptográfica. Nunca secuenciales ni derivados de fecha, lote o contador.
- Unicidad por clave primaria; si choca, se regenera. El lote entero en una transacción.
- Datos de prueba y ejemplos: también códigos aleatorios reales, nunca ABC123 ni similares.

## Fases

### Fase 1 (en construcción; objetivo: poder vender 6 prototipos)

- Redirección /n y /q con las cuatro combinaciones de sesión/estado.
- Login con un usuario, sobre una tabla de usuarios ampliable.
- Activación escaneando la placa, con conversión automática del link de
  Google Maps a link de reseña.
- Lotes desde /admin: códigos únicos, CSV y QR en SVG.
- Catálogo de modelos (D, E, F, G, H) en la base.
- Estadísticas por escaneo y por canal.
- Landing mínima de una página con botón de WhatsApp.

### Fase 2 (no tocar todavía; después de las primeras ventas)

- Pantalla para administrar usuarios y vendedores.
- Landing con diseño trabajado.
- Script Python local que genera el PDF de imprenta desde un lote.

### Fuera de alcance

- Pixel o etiquetas de publicidad.

## Entornos de Cloudflare

| | Desarrollo | Producción |
|---|---|---|
| Worker | `tokalo-dev` | `tokalo` |
| Dirección | tokalo-dev.tokaloperu.workers.dev | tokaloperu.com (www redirige a la raíz) |
| Base D1 | `tokalo-dev` (con datos de prueba) | `tokalo` (sin datos de prueba) |
| Desplegar (migra y luego sube) | `npm run desplegar` | `npm run desplegar:produccion` (avisar antes) |
| Solo migrar | `npm run migrar:dev` | `npm run migrar:produccion` |

"Always Use HTTPS" está activado en la zona. El Worker no debe redirigir http a https.

## Entorno local

- Python local: virtualenv `nfc` de virtualenvwrapper (`~/.virtualenvs/nfc`). No crear otros.
- `wrangler` está en `node_modules` del proyecto: usar `npx wrangler`.
- Esta máquina (WSL) no tiene IPv6 y su DNS local a veces falla: probar con `curl -4`.
- La base de los tests no se reinicia entre tests: usar `vaciarBase()` de `test/ayudas.ts`.
- `wrangler tail` se desconecta al redesplegar: reabrirlo tras cada despliegue.
