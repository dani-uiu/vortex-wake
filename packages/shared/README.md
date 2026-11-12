# @vortex-wake/shared

Tipos y validaciones compartidos por el generador y, más adelante, la aplicación.

- `src/model.ts`: modelo de datos de la captura (integrantes, sesiones, micro-entradas, adjuntos, hilos, páginas). Es el borrador de la sección 4 del plan; todavía no lo usa nada.
- `src/notebook.ts`: el **documento de páginas** que consume el generador (`NotebookDocument`), los tipos de página con sus campos (`PAGE_TYPES`) y las referencias entre páginas (`{{page:ID}}`).
- `src/validate.ts`: `validateNotebook()` revisa el JSON y devuelve los problemas con su ruta y un mensaje en español; `parseNotebook()` lanza un error con todos ellos.

Sin dependencias. Funciona en Node y en el navegador.
