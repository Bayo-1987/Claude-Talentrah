#!/usr/bin/env python3
"""THROWAWAY DIAGNOSTIC (send-473) — never merged to main.

Stage 2 of the multi-extractor measurement. Stage 1 (e2e/zz-diag-font-extraction.spec.ts, DUMP tests)
renders every registered resume template to a PDF with Chromium and saves it as
  <dir>/p<persona>__<face>__<slug>.pdf   plus   <dir>/p<persona>__<face>__<slug>.json
(the JSON holds the body words to look for and the pdf.js result). This script then runs every
available extractor over the IDENTICAL files and counts, per extractor, how many of a template's body
words fail to appear as a whole word (case-insensitive) in that extractor's output.

Extractors (each skipped, not faked, if its tool is missing; versions are logged as VER lines):
  pdfjs     — measured in stage 1 (pdf-parse 2.4.x)
  poppler   — pdftotext -raw
  pdfminer  — pdfminer.six  extract_text  (default LAParams)
  mutool    — mutool draw -F text
  pdfbox    — Apache PDFBox app  export:text

Output lines start with VER / ROW / AGG / STAT so they can be grepped out of a CI log.
"""
import concurrent.futures as cf
import csv
import glob
import json
import os
import re
import shutil
import subprocess
import sys
from collections import defaultdict

DIR = sys.argv[1] if len(sys.argv) > 1 else "/tmp/pdfs"
PDFBOX_JAR = os.environ.get("PDFBOX_JAR", "")
WORKERS = int(os.environ.get("EXTRACT_WORKERS", "4"))

# The 38 slugs production flags ats_safe = true (resume_templates.ats_safe, read 2026-09-30).
ATS_SAFE = set("""blueprint business-memo byline care-plan civic-record clean-professional compliance-brief
curriculum-vitae field-mission field-notes field-season filing-system foundation front-desk gantt gazette
harvest help-desk impact-report itinerary lecture-notes ledger legal-brief manifest network-ops offshore
public-record research-record rig-report rounds route-plan site-plan site-report specification statute
structured-admin success-story terminal""".split())


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=120, **kw)


def versions():
    out = {}
    for name, cmd in [
        ("poppler", ["pdftotext", "-v"]),
        ("mutool", ["mutool", "-v"]),
        ("java", ["java", "-version"]),
    ]:
        if shutil.which(cmd[0]):
            r = run(cmd)
            out[name] = (r.stdout + r.stderr).strip().splitlines()[0] if (r.stdout + r.stderr).strip() else "?"
        else:
            out[name] = "NOT INSTALLED"
    try:
        import pdfminer  # type: ignore
        out["pdfminer"] = "pdfminer.six " + getattr(pdfminer, "__version__", "?")
    except Exception:
        out["pdfminer"] = "NOT INSTALLED"
    out["pdfbox"] = os.path.basename(PDFBOX_JAR) if PDFBOX_JAR and os.path.exists(PDFBOX_JAR) else "NOT INSTALLED"
    return out


def extract(tool, pdf):
    try:
        if tool == "poppler":
            if not shutil.which("pdftotext"):
                return None
            return run(["pdftotext", "-raw", pdf, "-"]).stdout
        if tool == "mutool":
            if not shutil.which("mutool"):
                return None
            r = run(["mutool", "draw", "-q", "-F", "text", "-o", "-", pdf])
            if r.returncode != 0 or not r.stdout:
                r = run(["mutool", "draw", "-q", "-F", "txt", "-o", "-", pdf])
            return r.stdout
        if tool == "pdfminer":
            from pdfminer.high_level import extract_text  # type: ignore
            return extract_text(pdf)
        if tool == "pdfbox":
            if not (PDFBOX_JAR and os.path.exists(PDFBOX_JAR) and shutil.which("java")):
                return None
            out = pdf + ".pdfbox.txt"
            r = run(["java", "-jar", PDFBOX_JAR, "export:text", "-i", pdf, "-o", out])
            if not os.path.exists(out):
                return None
            with open(out, encoding="utf-8", errors="replace") as fh:
                return fh.read()
    except Exception as e:  # noqa: BLE001 - a broken tool must not abort the run
        print(f"WARN {tool} failed on {os.path.basename(pdf)}: {str(e)[:100]}", flush=True)
        return None
    return None


def missing(words, text):
    return [w for w in words if not re.search(r"(^|[^A-Za-z])" + re.escape(w) + r"([^A-Za-z]|$)", text, re.I)]


TOOLS = ["poppler", "pdfminer", "mutool", "pdfbox"]


def page_count(pdf):
    """Pages in the rendered PDF (poppler's pdfinfo). A layout side effect check: a fix that fixes
    extraction but pushes a one-page resume onto a second page has not been free."""
    if not shutil.which("pdfinfo"):
        return ""
    m = re.search(r"^Pages:\s+(\d+)", run(["pdfinfo", pdf]).stdout, re.M)
    return int(m.group(1)) if m else ""


def process(jpath):
    meta = json.load(open(jpath))
    pdf = jpath[:-5] + ".pdf"
    row = {"persona": meta["persona"], "face": meta["face"], "slug": meta["slug"],
           "words": len(meta["words"]), "pdfjs": len(meta["pdfjsMissing"]), "fams": "|".join(meta["fams"]),
           "pages": page_count(pdf), "ws": "|".join(meta.get("wsValues", []))}
    detail = {}
    for t in TOOLS:
        txt = extract(t, pdf)
        if txt is None:
            row[t] = ""
        else:
            miss = missing(meta["words"], txt)
            row[t] = len(miss)
            detail[t] = miss
    return row, detail, meta["pdfjsMissing"]


def main():
    print("VER", json.dumps(versions()), flush=True)
    metas = sorted(glob.glob(os.path.join(DIR, "*.json")))
    print(f"VER pdf_count={len(metas)} dir={DIR}", flush=True)
    rows, details = [], {}
    with cf.ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for row, detail, pj in ex.map(process, metas):
            rows.append(row)
            details[(row["persona"], row["face"], row["slug"])] = (detail, pj)
    with open(os.path.join(DIR, "results.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["persona", "face", "slug", "words", "pdfjs"] + TOOLS + ["fams", "pages", "ws"])
        w.writeheader()
        w.writerows(rows)
    for r in rows:
        print("ROW", r["persona"], r["face"], r["slug"], r["words"], r["pdfjs"], *[r[t] for t in TOOLS], flush=True)

    ext = ["pdfjs"] + TOOLS

    def agg(sel, label):
        for e in ext:
            vals = [(r["words"], r[e]) for r in sel if r[e] != ""]
            if not vals:
                print(f"AGG {label} {e} n/a", flush=True)
                continue
            W = sum(v[0] for v in vals)
            D = sum(v[1] for v in vals)
            hit = sum(1 for v in vals if v[1] > 0)
            print(f"AGG {label} {e} templates_hit={hit}/{len(vals)} words={D}/{W} pct={100*D/W:.2f}", flush=True)

    faces = sorted({r["face"] for r in rows})
    personas = sorted({r["persona"] for r in rows})
    for f in faces:
        for p in personas:
            agg([r for r in rows if r["face"] == f and r["persona"] == p], f"face={f} persona={p} all")
        agg([r for r in rows if r["face"] == f], f"face={f} personas=all all")
        agg([r for r in rows if r["face"] == f and r["slug"] in ATS_SAFE], f"face={f} personas=all ats_safe")
        agg([r for r in rows if r["face"] == f and r["slug"] not in ATS_SAFE], f"face={f} personas=all not_ats_safe")

    # ── word-spacing probe extras (harmless no-ops for the plain face run) ──
    ctrl = {(r["persona"], r["slug"]): r["pages"] for r in rows if r["face"] == "ss-ws0"}
    for f in faces:
        if not f.startswith("ss-ws"):
            continue
        changed = [(r["slug"], r["persona"], ctrl.get((r["persona"], r["slug"])), r["pages"]) for r in rows
                   if r["face"] == f and ctrl.get((r["persona"], r["slug"])) not in ("", None) and r["pages"] != "" and r["pages"] != ctrl.get((r["persona"], r["slug"]))]
        n = sum(1 for r in rows if r["face"] == f)
        print(f"PAGES {f} renders={n} pagecount_changed_vs_control={len(changed)} "
              f"more_pages={sum(1 for c in changed if c[3] > c[2])} fewer_pages={sum(1 for c in changed if c[3] < c[2])}", flush=True)
        for c in sorted(changed)[:12]:
            print(f"PAGES   {f} slug={c[0]} persona={c[1]} control_pages={c[2]} pages={c[3]}", flush=True)
        wsv = sorted({r["ws"] for r in rows if r["face"] == f})
        print(f"WSVALUES {f} distinct_computed_word_spacing_sets={wsv[:6]}", flush=True)
        # what still breaks under poppler, most frequent first
        from collections import Counter
        cnt = Counter()
        for r in rows:
            if r["face"] == f:
                cnt.update(details[(r["persona"], r["face"], r["slug"])][0].get("poppler", []))
        print(f"TOPDAMAGED {f} poppler {cnt.most_common(12)}", flush=True)
    if shutil.which("pdftoppm"):
        shots = os.path.join(DIR, "shots")
        os.makedirs(shots, exist_ok=True)
        for f in faces:
            for slug in ("clean-professional", "blueprint"):
                pdf = os.path.join(DIR, f"p0__{f}__{slug}.pdf")
                if os.path.exists(pdf):
                    run(["pdftoppm", "-r", "70", "-png", "-f", "1", "-l", "1", pdf, os.path.join(shots, f"{f}__{slug}")])

    # ── statute: which face does it really render in, and why do two 'faces' disagree on it? ──
    for r in sorted((r for r in rows if r["slug"] == "statute"), key=lambda r: (r["persona"], r["face"])):
        detail, pj = details[(r["persona"], r["face"], "statute")]
        print(f"STAT statute persona={r['persona']} face={r['face']} computed_families={r['fams']} "
              f"pdfjs={r['pdfjs']} poppler={r['poppler']} pdfminer={r['pdfminer']} mutool={r['mutool']} pdfbox={r['pdfbox']}", flush=True)
        for t in ("poppler",):
            if detail.get(t):
                print(f"STAT   {t} damaged words: {detail[t][:20]}", flush=True)
    if shutil.which("pdffonts"):
        for face in ("source-sans", "newsreader"):
            pdf = os.path.join(DIR, f"p0__{face}__statute.pdf")
            if os.path.exists(pdf):
                r = run(["pdffonts", pdf])
                for line in r.stdout.splitlines():
                    print(f"STAT pdffonts p0 {face}: {line}", flush=True)
        # show how one damaged word actually reads in poppler's output, for the disagreeing face
        det, _ = details.get((0, "newsreader", "statute"), ({}, []))
        pdf = os.path.join(DIR, "p0__newsreader__statute.pdf")
        if det.get("poppler") and os.path.exists(pdf):
            txt = run(["pdftotext", "-raw", pdf, "-"]).stdout
            for w in det["poppler"][:6]:
                i = txt.lower().find(w[:4].lower())
                print(f"STAT   how '{w}' reads under poppler (newsreader): {txt[i:i+len(w)+8]!r}", flush=True)
        det, _ = details.get((0, "source-sans", "statute"), ({}, []))
        print(f"STAT   source-sans statute poppler damaged words: {det.get('poppler')}", flush=True)


if __name__ == "__main__":
    main()
