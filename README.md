# Tokalo

Placas con chip NFC y código QR que llevan al cliente de un negocio a su página
de reseñas. Un solo Worker de Cloudflare (TypeScript) con base de datos D1, todo
en el plan gratuito.

- Producción: https://tokaloperu.com (admin en `/admin`)
- Desarrollo: https://tokalo-dev.tokaloperu.workers.dev

Las decisiones, mediciones y reglas de trabajo están en [CLAUDE.md](CLAUDE.md).

## Cómo funciona

| Quién escanea | Estado de la placa | Qué pasa |
|---|---|---|
| Público | Activa | Va al destino (reseña) y se cuenta el escaneo |
| Público | Sin activar, desactivada o inexistente | Va a la página de inicio |
| Usuario con sesión | Sin activar | Formulario de activación |
| Usuario con sesión | Activa o desactivada | Ficha de la placa |

Cada placa tiene dos direcciones con el mismo código: `/n/CODIGO` (chip NFC) y
`/q/CODIGO` (QR). El canal solo sirve para las estadísticas.

## Preparar la computadora

Hace falta Node.js y Python 3. Una sola vez:

```bash
npm install            # instala wrangler y las herramientas de test
npx wrangler login     # autoriza a wrangler en la cuenta de Cloudflare
```

## Comandos del día a día

```bash
npm test               # corre todos los tests
npm run revisar        # revisa los tipos de TypeScript
npm run dev            # servidor local en http://localhost:8787
```

## Desplegar

Siempre primero a desarrollo, se prueba, y después a producción.

```bash
# Desarrollo
npm run migrar:dev     # solo si hay migraciones nuevas en migrations/
npm run desplegar

# Producción
npm run migrar:produccion
npm run desplegar:produccion
```

Un `wrangler deploy` a secas va a desarrollo: producción hay que pedirla a
propósito. Si un cambio trae una migración, se aplica la migración antes de
desplegar el código.

## Usuarios

No hay pantalla de usuarios todavía. Se crean con un script que genera la
contraseña, la muestra una sola vez y guarda solo su hash:

```bash
python3 scripts/crear_usuario.py produccion --usuario maria --nombre "María Quispe"
python3 scripts/crear_usuario.py produccion --usuario maria --cambiar-clave
```

Para desarrollo, cambiar `produccion` por `dev`. Una contraseña perdida no se
recupera: se reemplaza con `--cambiar-clave`, que además quita el bloqueo por
intentos fallidos.

Para quitarle el acceso a alguien sin borrar su historial:

```bash
npx wrangler d1 execute tokalo --env produccion --remote \
  --command "UPDATE usuarios SET activo = 0 WHERE usuario = 'maria'"
```

Su sesión deja de valer en la siguiente solicitud.

## Crear un lote de placas

1. Entrar a `/admin` → **Lotes**.
2. Elegir el modelo y la cantidad (hasta 500) y pulsar **Crear lote**.
3. **Descargar CSV**: trae `codigo`, `url_nfc` (para grabar en el chip) y
   `url_qr` (lo que va dentro del QR, en mayúsculas).
4. **Códigos y QR**: lista las placas del lote; cada una tiene **Ver QR** y
   **Descargar QR** (archivo SVG, se puede escalar a cualquier tamaño).

Un lote solo se puede eliminar si ninguna de sus placas fue activada.

Si hace falta un modelo nuevo (por ejemplo, un tótem para Instagram), se crea
antes en **Modelos**, indicando su plataforma.

## Activar una placa

1. Iniciar sesión en `/admin` desde el navegador predeterminado del celular
   (Safari en iPhone, Chrome en Android).
2. Acercar el celular al chip de la placa o escanear su QR con la cámara. Se
   abre el formulario con el código ya puesto.
3. Llenar negocio, responsable y teléfono, y pegar el link:
   - placa de Google: el link de Google Maps del negocio (botón "Compartir");
   - placa de otra plataforma: el link del negocio en esa plataforma.
4. Pulsar **Revisar link**. Aparece el destino con el enlace **Probar**: debe
   abrir el formulario de reseña del negocio correcto.
5. Pulsar **Activar placa**.

Si el link de Maps no se puede convertir, el formulario pide pegar el link de
reseña directamente.

Desde la ficha de una placa activa se puede cambiar el destino (queda en el
historial), editar los datos del negocio y desactivarla.

## Ver qué está pasando

- **Placas**: todas las placas con su destino y sus escaneos. La casilla "Solo
  destinos que no son de la plataforma de su modelo" muestra los destinos raros.
- **Reportes → Escaneos**: lecturas NFC y QR de cada placa en un rango de fechas.
- **Reportes → Activaciones**: placas activadas por día, semana o mes, y por
  usuario. Ambos reportes se descargan en CSV.
- **Errores**: panel de Cloudflare → Workers & Pages → `tokalo` → Observability.
  Los errores atrapados aparecen como `error_atrapado`.

## Respaldar la base

```bash
npm run respaldar                  # producción
python3 scripts/respaldar.py dev   # desarrollo
```

Deja un archivo `respaldos/tokalo-FECHA.sql` con la estructura y todos los
datos. La carpeta `respaldos/` no entra en git porque contiene nombres y
teléfonos de clientes: hay que copiar el archivo a un lugar seguro fuera de la
computadora. Mientras dura la exportación, la base no atiende otras consultas
(con pocos datos son unos segundos).

Conviene hacerlo antes de cada migración y de forma periódica.

### Restaurar un respaldo

Para revisar un respaldo sin tocar nada real, se carga en una base local:

```bash
npx wrangler d1 execute tokalo --env produccion --local \
  --persist-to /tmp/revisar-respaldo --file respaldos/tokalo-FECHA.sql
npx wrangler d1 execute tokalo --env produccion --local \
  --persist-to /tmp/revisar-respaldo --command "SELECT COUNT(*) FROM placas"
```

Para restaurarlo de verdad, el archivo debe cargarse en una base **vacía**
(crea las tablas, así que falla si ya existen):

```bash
npx wrangler d1 create tokalo-restaurada --location enam
npx wrangler d1 execute tokalo-restaurada --remote --file respaldos/tokalo-FECHA.sql
```

Después se cambia el `database_id` de `[env.produccion]` en `wrangler.toml` por
el de la base nueva y se despliega.

### Volver atrás en el tiempo (sin respaldo)

Cloudflare guarda solo el historial de la base: 7 días en el plan gratuito.
Sirve para deshacer un error reciente.

```bash
npx wrangler d1 time-travel info tokalo --env produccion
npx wrangler d1 time-travel restore tokalo --env produccion --timestamp="2026-11-11T15:00:00Z"
```

`restore` reemplaza la base entera por como estaba en ese momento. Al terminar
muestra un marcador para deshacer la restauración.

## Estructura del proyecto

```
src/
  index.ts          entrada: enruta y atrapa errores (nunca un 500 al público)
  rutas/            una función por grupo de direcciones (público, admin, lotes...)
  lib/              la lógica: códigos, QR, conversión de Maps, sesión, reportes
  vistas/           funciones que devuelven el HTML de cada pantalla
migrations/         cambios de la base, numerados; nunca se editan los ya aplicados
test/               un archivo de tests por tema
scripts/            utilidades locales en Python (usuarios, respaldo)
datos/prueba.sql    placas de prueba, solo para desarrollo
```

## Límites del plan gratuito a tener presentes

- 10 ms de CPU por solicitud y 100 000 solicitudes al día.
- D1: 5 millones de filas leídas y 100 000 escritas al día.
- Si se llega a un límite, Cloudflare corta el servicio hasta el día siguiente;
  no cobra.
