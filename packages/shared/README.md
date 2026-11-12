# @vortex-wake/shared

Tipos, reglas y validaciones compartidos por la app, el servidor y el generador.

- `src/model.ts`: modelo de la **captura**: equipo (`TeamConfig`: integrantes y robots con subsistemas), sesiones (un día; asistencia y cierre de tres preguntas) y micro-entradas (`Entry`: contenedor de elementos —fotos, texto, enlace, lista, tabla, contador de pruebas— con clasificación opcional: autores, robot, subsistema, sección, tipo, marcas e hilo). También las etiquetas en español y `newId()` (ids del cliente con `crypto.getRandomValues`, que sí existe por HTTP en la red local).
- `src/api.ts`: **contrato HTTP** entre la app y el servidor (rutas, cuerpos, respuestas) y sus reglas de mezcla como funciones puras: entradas por `updatedAt` (gana la más reciente), asistencia por unión, cierre por `updatedAt`, fotos inmutables. Hoy lo implementa `packages/dev-server`; un Worker de Cloudflare (D1 + R2) debe implementar las mismas rutas usando estas mismas funciones.
- `src/assemble.ts`: **armado automático** (entradas → documento de páginas). Ver las reglas abajo.
- `src/notebook.ts`: el **documento de páginas** que consume el generador (`NotebookDocument`), los tipos de página con sus campos (`PAGE_TYPES`) y las referencias entre páginas (`{{page:ID}}`).
- `src/validate.ts`: `validateNotebook()` revisa el documento y devuelve los problemas con su ruta y un mensaje en español; `parseNotebook()` lanza un error con todos ellos.

Sin dependencias. Funciona en Node y en el navegador.

## Armado automático

La herramienta no redacta: solo acomoda lo que el equipo escribió. Los campos sin nada capturado quedan vacíos.

- **Una página por grupo** de entradas con la misma sección, tipo, robot, subsistema e hilo. "Trabajo del día", construcción y las entradas sin hilo se agrupan además por día (en construcción, cada día del hilo es una iteración `#n`).
- **Sin tipo** → "trabajo del día". **Sin sección** → se deduce del tipo (código → Programación, cableado → Cableado, análisis del juego y autónomo → Estrategia, construcción y mecanismo → Mecánica) o va a Mecánica, con aviso. Un tipo que la plantilla no trae en esa sección pasa a "trabajo del día", con aviso.
- **Subsistema y robot** van al título (`[subsistema]` → "intake (Robot A)").
- **Autores**: los de cada entrada; si una no tiene, quien la capturó.
- **Campos por tipo** (texto · fotos · tabla · contador):

| Tipo | Texto | Fotos | Tabla | Contador |
|---|---|---|---|---|
| Trabajo del día | notes | notes | (como texto) | (resumen en texto) |
| Problema | problem | problem | criteria | texto |
| Lluvia de ideas | context | sketches | ideas | texto |
| Construcción | changes | photos | texto | testResults (resumen) |
| Prueba | analysis | analysis | results | results (una fila por intento: n, Acierto/Fallo, nota) |
| Decisión | decision | evidence | options | texto |
| Mecanismo | howItWorks | picture | labels | texto |
| Código | purpose | pseudocode | texto | relatedTests (resumen) |
| Cableado | problems | diagram | ports | texto |
| Reflexión | learned | learned | texto | texto |
| Análisis del juego | strategy | strategy | priorities | texto |
| Autónomo | rationale | path | steps | testResults (resumen) |

- Las listas van como renglones con viñeta; los enlaces como "título: url". Si una fila de tabla tiene más columnas que la de la plantilla, las de más se juntan en la última (no se pierde texto); el encabezado de la tabla capturada se reemplaza por el de la plantilla.
- **Marca "cambio"** → registro de cambios de la sección, con el texto de la entrada (Estrategia no tiene registro de cambios: aviso).
- **Marca "inspiración"** → créditos: cada enlace de la entrada es una fuente; "qué usamos" es el texto de la entrada.
- **Sesiones** → cronología: "Taller (presentes)" y, como resumen, el "qué hicimos" del cierre.
- **Integrantes** → su tabla (iniciales calculadas si faltan).
