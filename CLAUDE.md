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

Links de Maps compartidos desde iPhone (maps.app.goo.gl/...?g_st=ic): el primer salto
302 trae `ftid=0xAAAA:0xBBBB`, también cuando la petición sale desde Cloudflare.

## Condiciones para el código

- Pocas dependencias, sin frameworks grandes. Justificar cada una.
- TypeScript estricto, código simple y comentado en español (el dueño lo lee viniendo de Python).
- Frontend: HTML y CSS simples servidos por el Worker. Sin React ni build pesado.
- Datos en D1, siempre con migraciones.
- No guardar DNI, IP ni user-agent completo.
- Nunca un error 500 al público.

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

## Entorno

- Python local: virtualenv `nfc` de virtualenvwrapper (`~/.virtualenvs/nfc`). No crear otros.
- `wrangler` está en `node_modules` del proyecto: usar `npx wrangler`.
- `wrangler tail` se desconecta al redesplegar: reabrirlo tras cada despliegue.
