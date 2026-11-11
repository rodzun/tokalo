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
    y plataforma por modelo (hecha en desarrollo; falta producción).
12. Reportes: escaneos por código y canal; activaciones por día/semana/mes y por usuario,
    con filtros.
13. README y respaldo.

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
| Desplegar | `npm run desplegar` | `npm run desplegar:produccion` (avisar antes) |
| Migrar | `npm run migrar:dev` | `npm run migrar:produccion` |

"Always Use HTTPS" está activado en la zona. El Worker no debe redirigir http a https.

## Entorno local

- Python local: virtualenv `nfc` de virtualenvwrapper (`~/.virtualenvs/nfc`). No crear otros.
- `wrangler` está en `node_modules` del proyecto: usar `npx wrangler`.
- Esta máquina (WSL) no tiene IPv6 y su DNS local a veces falla: probar con `curl -4`.
- La base de los tests no se reinicia entre tests: usar `vaciarBase()` de `test/ayudas.ts`.
- `wrangler tail` se desconecta al redesplegar: reabrirlo tras cada despliegue.
