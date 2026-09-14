#!/usr/bin/env python3
"""Assemble the House of Picklers sources into two deliverables:

  index.html          a standalone page (double-click to open, works offline)
  dist/artifact.html  the same page without the outer document wrapper,
                      ready for publishing as a hosted Artifact
"""
import io, os, pathlib, datetime

HERE = pathlib.Path(__file__).parent
SRC = HERE / "src"

def read(name):
    return io.open(SRC / name, encoding="utf-8").read().rstrip() + "\n"

head    = read("head.html")
css     = read("app.css")
body    = read("body.html")
BUILD = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

scripts = "".join(
    '<script>\n%s</script>\n' % read(n).replace("__BUILD__", BUILD)
    for n in ("scheduler.js", "store.js", "app.js")
)

page = "%s<style>\n%s</style>\n%s%s" % (head, css, body, scripts)

standalone = (
    '<!doctype html>\n<html lang="en">\n<head>\n'
    '<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
    '<meta name="description" content="Roster in, rounds out: House of Picklers builds pickleball rotations, records scores and keeps the standings live.">\n'
    '<meta name="theme-color" content="#098476">\n'
    '%s<style>\n%s</style>\n</head>\n<body>\n%s%s</body>\n</html>\n'
) % (head, css, body, scripts)

(HERE / "index.html").write_text(standalone, encoding="utf-8")
(HERE / "dist").mkdir(exist_ok=True)
(HERE / "dist" / "artifact.html").write_text(page, encoding="utf-8")

print("build %s" % BUILD)
for p in ("index.html", "dist/artifact.html"):
    print("%-20s %6.1f KB" % (p, (HERE / p).stat().st_size / 1024))
