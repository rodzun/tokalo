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

## Condiciones para el código

- Pocas dependencias, sin frameworks grandes. Justificar cada una.
- TypeScript estricto, código simple y comentado en español (el dueño lo lee viniendo de Python).
- Frontend: HTML y CSS simples servidos por el Worker. Sin React ni build pesado.
- Datos en D1, siempre con migraciones.
- No guardar DNI, IP ni user-agent completo.
- Nunca un error 500 al público.

## Login y sesión (aprobado 2026-11-11)

- Usuario y contraseña propios. PBKDF2-SHA256 con 25 000 iteraciones; el número va
  guardado dentro del hash (`pbkdf2$iteraciones$sal$hash`) para poder subirlo.
- Contraseñas generadas por `scripts/crear_usuario.py`, no elegidas por la persona.
- Cookie firmada, 30 días, `Secure; HttpOnly; SameSite=Lax; Path=/`. Debe enviarse cuando
  el navegador se abre desde un toque NFC o un QR (navegación iniciada fuera del sitio).
- En cada solicitud con cookie se comprueba en la base que el usuario siga activo.
- Límite de intentos: 5 fallos bloquean 15 minutos.
- Los escaneos hechos con sesión no se registran en estadísticas.
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
10. Activación.
11. Admin.
12. README y respaldo.

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
