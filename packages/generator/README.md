# @vortex-wake/generator

Genera la bitácora de ingeniería (`.pptx`) a partir de la plantilla y de un documento JSON con las páginas ya armadas. El resultado se puede seguir editando a mano en PowerPoint: todo son cuadros de texto, tablas e imágenes reales.

## Uso

Desde la raíz del repositorio:

```
npm run generate -- examples/notebook-ejemplo/notebook.json \
  --template template/V5_Engineering_Notebook_Template_ES.pptx \
  --out output/ejemplo.pptx [--numbering section|continuous] [--reference-pages] [--list]
```

| Opción | Qué hace |
|---|---|
| `--numbering section` | Numeración por sección (por defecto): `M-1`, `C-1`... Para trabajar. |
| `--numbering continuous` | Numeración corrida `1, 2, 3...`. Para la entrega final. |
| `--reference-pages` | Agrega al final las páginas de referencia de la plantilla (rayada, en blanco, cuadrícula). |
| `--no-resources` | Omite la página de recursos de VEX. |
| `--keep-help-text` | Conserva el texto gris de ayuda bajo cada encabezado (por defecto se quita). |
| `--list` | Muestra cada diapositiva generada con su número y título. |

Las rutas de las imágenes del documento son relativas al archivo JSON. La salida va a `output/`, que está en `.gitignore`.

Desde código (Node o navegador), el núcleo recibe y devuelve bytes; no usa `fs`:

```ts
import { generateNotebook } from '@vortex-wake/generator';

const { bytes, pages, warnings } = await generateNotebook({
  template,                       // Uint8Array de la plantilla .pptx
  document,                       // el JSON (se valida adentro)
  loadAsset: (src) => fotos[src], // Uint8Array (o promesa) de cada imagen
  options: { numbering: 'section' },
});
```

## El documento

Lo define `packages/shared/src/notebook.ts` y lo valida `validateNotebook()` (mensajes en español, con la ruta del problema). Forma general:

```jsonc
{
  "format": "vortex-wake/notebook", "version": 1, "language": "es",
  "project": "Equipo 1234A · Temporada 2026-2027",          // pie: Proyecto
  "team": { "number": "1234A", "name": "...", "school": "..." },
  "season": { "start": "2026-09-01", "end": "2027-04-30" },
  "cover": { "photo": { "src": "fotos/equipo.jpg" } },       // opcional: portada con foto
  "members": [{ "id": "ana", "name": "...", "roles": ["..."], "grade": "...", "initials": "AR" }],
  "editors": ["ana"],                                        // firman las páginas automáticas
  "sessions": [{ "date": "2026-09-04", "event": "Taller", "summary": "..." }],
  "pages": [{
    "id": "m-build-2", "type": "buildIteration", "section": "mechanics",
    "date": "2026-09-19", "authors": ["ana"],
    "subsystem": "intake", "thread": "intake",               // #__ sale del hilo
    "fields": {
      "origin": "Continúa la iteración #1 (pág. {{page:m-build-1}}).",
      "photos": { "images": [{ "src": "fotos/v2.jpg", "caption": "Intake v2" }] },
      "testResults": { "text": "...", "images": [] }
    },
    "changes": [{ "change": "...", "test": "m-test-1", "evidence": "13 de 16", "result": "..." }],
    "credits": [{ "source": "...", "used": "...", "changes": "..." }]
  }]
}
```

- **Referencias:** en cualquier texto, `{{page:ID}}` se cambia por el número de esa página con el esquema activo (`M-4` o `27`). El documento nunca guarda números de página. Conviene escribir "pág. {{page:ID}}", porque con numeración corrida el número queda solo.
- **Recuadros:** texto (párrafos separados por `\n`) o `{ text, images, code }`. `code: true` usa letra monoespaciada (pseudocódigo).
- **Tablas:** lista de filas, cada una lista de celdas. En las tablas de filas fijas (montaje de la prueba, plan de partido, iteration tracker) la primera columna ya trae su etiqueta en la plantilla y el documento llena las demás.
- **Título:** se toma el de la página modelo; `[subsystem]` se cambia por `subsystem` y `#__` por el número de iteración (explícito o según el orden del hilo). `title` reemplaza todo el título.

Campos de cada tipo de página:

| Tipo | Secciones | Campos (r = recuadro, t = tabla) |
|---|---|---|
| `seasonSummary` | comunes | teamAndGoals r, highlights t(3), biggestChanges r, lessons r |
| `codeSummary` | comunes | overview r, programs t(3), sensors t(3), algorithms r, details r |
| `teamMembers` | organización | howWeWork r, mentors r, teamPhoto r (la tabla sale de `members`) |
| `problem` | mechanics, coding | challenge r, problem r, criteria t(3), constraints t(3), nextStep r |
| `brainstorm` | mechanics, coding, strategy | context r, sketches r, ideas t(4), matrix t(5), chosen r |
| `buildIteration` | mechanics | origin r, changes r, photos r, testResults r, nextSteps r |
| `test` | mechanics, coding, strategy | hypothesis r, setup t(1, 5 filas fijas), results t(4), analysis r, conclusion r |
| `decision` | las cuatro | decision r, options t(4), evidence r, process r, expectations r |
| `mechanism` | mechanics | purpose r, picture r, labels t(3), howItWorks r |
| `codeDoc` | coding | purpose r, rationale r, pseudocode r, debugging r, relatedTests r |
| `wiringDoc` | wiring | diagram r, ports t(4), problems r |
| `reflection` | las cuatro | period r, worked r, didNotWork r, learned r, planChanges r, tracker t(2, 3 filas fijas) |
| `gameAnalysis` | strategy | priorities t(5), matchPlan t(2, 3 filas fijas), strategy r, participants r |
| `autonomousPlan` | strategy | path r, steps t(4), rationale r, testResults r |

Páginas automáticas (no se escriben en el documento): tabla de contenido, **Team Members & Roles** (de `members`; si hay una página `teamMembers` se le agregan sus recuadros), **Season Timeline** (de `sessions`, con las páginas fechadas ese día), **Change Log** de Mechanics, Coding y Wiring (de los `changes` de cada página; la plantilla no trae Change Log en Strategy) y **Credit Summary** (de los `credits`, con las páginas donde se usó cada fuente).

## Orden y numeración

Portada → recursos → tabla de contenido → resúmenes y créditos → separador de Organización, integrantes y cronología → Mechanics, Coding, Wiring y Strategy, cada una con su separador y sus páginas por fecha (empates: en el orden del documento). El registro de cambios de cada sección va al final de esa sección. Las páginas de referencia, solo con `--reference-pages`.

No salen: "How to Use This Template", "Rubric Map", las páginas modelo sin usar, los calendarios, el mapa de puertos, el mapa del control y los mapas del campo, ni las notas "RUBRIC TIP" / "SUMMARY PAGE".

Prefijos de la numeración por sección: `G` páginas comunes (general), `T` organización del equipo (team), `M` mecánica, `C` código, `W` cableado (wiring), `S` estrategia, `R` referencia. La portada y los separadores no llevan número. Las continuaciones llevan su propio número y no salen en la tabla de contenido. Los prefijos se pueden cambiar con la opción `prefixes`.

Las páginas de recursos y de tabla de contenido sí cuentan en la numeración, pero su diseño en la plantilla no tiene pie, así que el número no se ve en ellas.

## Desborde: texto largo, tablas largas y muchas fotos

Estrategia (en `src/layout.ts`): medida aproximada + reacomodo + página de continuación.

1. Cada campo es un bloque (encabezado + recuadro o tabla) en la posición de la plantilla.
2. Se mide el alto que necesita cada bloque: el texto con la tabla de anchos de Arial (la fuente de los cuadros), cada fila de tabla según el texto de sus celdas, y las fotos con un lado mínimo legible de 60 pt.
3. Si todo cabe arriba del pie, los bloques que necesitan más crecen y empujan a los siguientes; las tablas agregan filas mientras quepan.
4. Si no cabe, primero se quita el espacio vacío (recuadros más grandes que su texto, filas vacías de relleno), luego se compactan las filas de tabla y las fotos, y al final se reparte de arriba hacia abajo.
5. Lo que sobra (líneas de texto, filas, fotos) pasa a una **página de continuación** del mismo tipo, con el título "(cont.)", solo con los campos que se desbordaron y con el encabezado de la tabla repetido. Se repite si hace falta.

Límites conocidos:

- La medida es aproximada (no hay motor de render): se usa un margen de seguridad, así que a veces queda un renglón vacío de más al final de un recuadro. Caracteres fuera del latín se miden con un ancho promedio.
- El texto nunca se achica (salvo el título, que baja de 20 a 14 pt si ocupa más de tres renglones).
- Una celda de tabla con más texto del que cabe en una página completa se sale del cuadro (las filas no se parten a la mitad).
- Las tablas de filas fijas no se parten.
- El corte de texto entre página y continuación es por renglón, aunque quede a mitad de un párrafo.

## Mapa de campos

`src/field-map.json` dice qué forma de la página modelo es cada campo (`Rectangle 9` → `challenge`), cuáles son el encabezado, la etiqueta de sección, el título y las notas que se quitan. No se usa el texto de la plantilla, así que sirve igual para la versión en inglés y en español.

Las páginas modelo se encuentran así: la sección sale de los separadores (diapositivas que solo tienen un título; su orden está en `sectionOrder`) y, dentro de la sección, la página es la que tiene **exactamente** el conjunto de nombres de formas del mapa y el mismo número de columnas en cada tabla. Si la plantilla cambia (se renombra una forma, se agrega una, se mueve una página de sección), `npm test` falla en `test/template-map.test.ts` diciendo qué página y qué forma ya no coinciden, y el generador también se detiene con ese mensaje.

## Dependencias

| Paquete | Para qué | Por qué este |
|---|---|---|
| `fflate` | Leer y escribir el zip del `.pptx` | Pequeño, sin dependencias, funciona igual en Node y en el navegador, API síncrona sobre `Uint8Array`. |
| `@xmldom/xmldom` | Leer, editar y escribir el XML de las diapositivas | DOM estándar con espacios de nombres en Node (que no trae `DOMParser`); en el navegador evita depender de diferencias entre implementaciones. |

Solo para desarrollo (en la raíz): `typescript` (revisión de tipos), `vitest` (pruebas) y `@types/node` (tipos del CLI y de las pruebas). El CLI corre directo con Node ≥ 22.18, que ejecuta TypeScript quitando los tipos; no hace falta compilar ni `tsx`.

## Pruebas y verificación

`npm test` corre, contra la plantilla real (EN y, si existe, ES): el mapa de campos, numeración en ambos modos, referencias, orden, páginas automáticas, crecimiento y continuación de tablas, texto largo, fotos y validez del paquete (XML bien formado, relaciones, tipos de contenido, ids únicos, sin partes huérfanas).

Las pruebas no sustituyen abrir el archivo: cada cambio al acomodo se revisó abriendo la salida en PowerPoint (por COM), exportando cada diapositiva a PNG y viéndolas una por una, y guardando y volviendo a abrir el archivo.

## Pendiente

- Calendarios (semanal y mensuales), mapa de puertos del Brain, mapa del control y mapas del campo: quedan fuera de esta etapa (no se incluyen en la salida).
- Fecha de cada continuación: usa la de la página original.
- Los resúmenes de temporada y de código se escriben a mano en el documento; todavía no se prellenan con hitos ni programas.
