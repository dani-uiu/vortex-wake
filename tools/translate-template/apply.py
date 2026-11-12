"""Genera la plantilla en español a partir de la inglesa y es.json.

Uso: python -I tools/translate-template/apply.py [EN.pptx] [es.json] [ES.pptx]

Sustituye el texto de los <a:t> párrafo por párrafo en ppt/slides, ppt/slideLayouts
y ppt/slideMasters, y marca los párrafos traducidos y los vacíos con lang="es-MX"
para que PowerPoint los revise como español. No toca nada más del XML. Conserva el orden de las entradas del
zip y el método de compresión de cada una.

Al terminar imprime los párrafos que quedaron sin traducir y sale con error si
algún par de es.json no se usó nunca (la clave no coincide con el original).
"""
import html, json, os, re, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "template", "V5_Engineering_Notebook_Template_EN.pptx")
TR = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "es.json")
DST = sys.argv[3] if len(sys.argv) > 3 else os.path.join(ROOT, "template", "V5_Engineering_Notebook_Template_ES.pptx")

PART = re.compile(r"ppt/(slides|slideLayouts|slideMasters)/[^/]+\.xml$")
PARA = re.compile(r"<a:p>(.*?)</a:p>", re.S)
RUN = re.compile(r"<a:t>([^<]*)</a:t>")

# Párrafos que se quedan igual a propósito (números, marcadores, nombres, términos
# oficiales del juego). Se listan aparte para que lo inesperado resalte.
KEEP = re.compile(r"^(\d+|0000|00/00/0000|#|ITSMQ|Idea( [ABC])?|Sensor|Plan|Endgame|BUMPER|STICK"
                  r"|Game Manual .*|0 Violations|6 Pins; 2 Goals x 2 Pins|(\w+)?\.?vex\.com)$")

# Reducciones de tamaño de letra explícitas, solo donde acortar la traducción no
# bastó para que el texto cupiera en su cuadro. Clave: (parte, texto inglés del
# párrafo, con sus fragmentos unidos). Valor: (sz original, sz nuevo) en
# centésimas de punto; se cambia sz="orig" por sz="nuevo" solo dentro de ese párrafo.
FONT_SHRINK = {
    # Portadas: "V5.1 Fecha 12.10.26" no cabe en su cuadro estrecho a 12 pt y la fecha
    # bajaba a una segunda línea oculta. Quitar "Fecha" perdería la etiqueta, así
    # que se baja de 12 a 11 pt.
    ("ppt/slides/slide1.xml", "V5.1 Date 10.12.26"): ("1200", "1100"),
    ("ppt/slides/slide2.xml", "V5.1 Date 10.12.26"): ("1200", "1100"),
}


LANG = "es-MX"
RPR_TAG = re.compile(r"<a:(rPr|endParaRPr)\b([^>]*?)(/?)>")
LANG_ATTR = re.compile(r'\s+lang="[^"]*"')
RUN_NO_RPR = re.compile(r"<a:r>(?!<a:rPr\b)")


def mark_spanish(body):
    """Marca los fragmentos traducidos como español de México (revisión ortográfica)."""
    body = RPR_TAG.sub(lambda m: f'<a:{m.group(1)} lang="{LANG}"{LANG_ATTR.sub("", m.group(2))}{m.group(3)}>', body)
    return RUN_NO_RPR.sub(f'<a:r><a:rPr lang="{LANG}"/>', body)


def key_of(side):
    return tuple(side) if isinstance(side, list) else (side,)


def main():
    pairs = json.load(open(TR, encoding="utf8"))
    table, used = {}, set()
    for en, es in pairs:
        k, v = key_of(en), key_of(es)
        if len(k) != len(v):
            sys.exit(f"Longitudes distintas en es.json: {k!r} -> {v!r}")
        if k in table and table[k] != v:
            sys.exit(f"Clave duplicada con traducciones distintas en es.json: {k!r}")
        table[k] = v

    missing = {}  # párrafo sin traducir -> partes donde aparece
    shrink_used = set()

    def translate(name, xml):
        def para(m):
            body = m.group(1)
            runs = tuple(html.unescape(t) for t in RUN.findall(body))
            if not any(r.strip() for r in runs):
                # Párrafo vacío (recuadros y celdas por llenar): lo que el equipo
                # escriba ahí hereda este idioma, así que también va en español.
                return "<a:p>" + mark_spanish(body) + "</a:p>"
            tr = table.get(runs)
            if tr is None:
                missing.setdefault(runs, []).append(name)
                return m.group(0)
            used.add(runs)
            it = iter(tr)
            body = RUN.sub(lambda r: "<a:t>" + html.escape(next(it), quote=False) + "</a:t>", body)
            body = mark_spanish(body)
            sk = (name, "".join(runs))
            if sk in FONT_SHRINK:
                old, new = FONT_SHRINK[sk]
                body, n = re.subn(rf'\bsz="{old}"', f'sz="{new}"', body)
                if n == 0:
                    sys.exit(f"FONT_SHRINK no encontró sz={old} en {sk!r}")
                shrink_used.add(sk)
            return "<a:p>" + body + "</a:p>"
        return PARA.sub(para, xml)

    zin = zipfile.ZipFile(SRC)
    tmp = DST + ".tmp"
    with zipfile.ZipFile(tmp, "w") as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if PART.match(info.filename):
                data = translate(info.filename, data.decode("utf8")).encode("utf8")
            zi = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            zi.compress_type = info.compress_type
            zi.external_attr = info.external_attr
            zi.create_system = info.create_system
            zout.writestr(zi, data)
    os.replace(tmp, DST)

    def show(runs):
        return "".join(runs).replace("\t", "\\t")

    expected = [r for r in missing if KEEP.match(show(r))]
    unexpected = [r for r in missing if r not in expected]
    print(f"Escrito: {DST}")
    print(f"Párrafos traducidos (únicos): {len(used)}; sin traducir: {len(missing)}")
    print(f"\nSin traducir, a propósito ({len(expected)}):")
    for r in expected:
        print("  ", show(r))
    print(f"\nSin traducir, INESPERADOS ({len(unexpected)}):")
    for r in unexpected:
        print("  ", show(r), "  <-", ", ".join(sorted(set(missing[r]))[:3]))

    unused = [k for k in table if k not in used]
    bad_shrink = [k for k in FONT_SHRINK if k not in shrink_used]
    if bad_shrink:
        print("\nERROR: reducciones de letra que no se aplicaron:", bad_shrink)
    if unused:
        print(f"\nERROR: {len(unused)} pares de es.json nunca se usaron:")
        for k in unused:
            print("  ", show(k))
    if unused or bad_shrink:
        sys.exit(1)


if __name__ == "__main__":
    main()
