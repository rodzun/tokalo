# Tokalo

Placas NFC + QR que redirigen a la página de reseñas de un negocio.
Dominio: tokaloperu.com (en la cuenta de Cloudflare del dueño).
El dueño trabaja solo, es backend Python y no sabe frontend.

## Reglas de trabajo

- Antes de cada etapa: mostrar plan y problemas, y esperar aprobación.
- Solo plan gratuito de Cloudflare (Workers + D1). Nada que cueste.
- Explicar cada paso manual que le toque al dueño (login, dominio) y por qué.
- Responder en español, directo y breve.
- Commits pequeños. No desplegar a producción sin avisar.

## Decisiones técnicas

- Frontend: HTML y CSS simples servidos por el Worker. Sin React ni build pesado.
- Lenguaje: pendiente del resultado del Paso 0 (prueba de CPU de Python en Workers).
  Si Python queda cerca de los 10 ms de CPU, la redirección va en TypeScript
  y el resto en Python.
- Datos en D1, siempre con migraciones.
- No guardar DNI, IP ni user-agent completo.

## Fuera de alcance por ahora

- PDF de imprenta (irá en un script Python local).
- Pantalla para administrar usuarios.
- Pixel o etiquetas de publicidad.
