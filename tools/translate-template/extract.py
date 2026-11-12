"""Lista los párrafos únicos de la plantilla (como listas de fragmentos de texto) en un JSON."""
import json, re, sys, zipfile, html

src, out = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(src)
parts = [n for n in z.namelist() if re.match(r"ppt/(slides|slideLayouts|slideMasters)/[^/]+\.xml$", n)]
seen, paras = set(), []
for n in sorted(parts):
    x = z.read(n).decode("utf8")
    for p in re.findall(r"<a:p>(.*?)</a:p>", x, re.S):
        runs = tuple(html.unescape(t) for t in re.findall(r"<a:t>([^<]*)</a:t>", p))
        if not any(r.strip() for r in runs) or runs in seen:
            continue
        seen.add(runs)
        paras.append(list(runs))
json.dump(paras, open(out, "w", encoding="utf8"), ensure_ascii=False, indent=0)
print(len(paras), "párrafos únicos;", sum(len(p) for p in paras), "fragmentos;", sum(len(r) for p in paras for r in p), "caracteres")
