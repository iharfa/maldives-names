#!/usr/bin/env python3
"""
Extract building/road labels from the MBS Malé City census map PDFs
(https://statisticsmaldives.gov.mv/maale-city-map/ — maale.pdf,
hulhumaale.pdf, villingili.pdf, Dec 2024).

The PDFs are large vector maps where every building carries its name as a
text label. Words are clustered back into labels by position: same text line
(similar top), small horizontal gap. Multi-line labels are then merged when
two label boxes sit directly above each other with matching left edges.

Output: data/raw/mbs_pdf_labels.json
  { "<island>": ["label", ...], ... }
"""
import json
import re
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"

PDFS = {
    "Malé": "mbs_maale.pdf",
    "Hulhumalé": "mbs_hulhumaale.pdf",
    "Villingili": "mbs_villingili.pdf",
}


def cluster_words(words):
    """Group word fragments into single-line labels by proximity."""
    lines = {}
    for w in words:
        key = (round(w["top"] / 4), w.get("upright", True))
        lines.setdefault(key, []).append(w)

    labels = []
    for (_, upright), ws in lines.items():
        ws.sort(key=lambda w: w["x0"])
        cur = [ws[0]]
        for w in ws[1:]:
            prev = cur[-1]
            height = max(prev["bottom"] - prev["top"], 4)
            if w["x0"] - prev["x1"] <= height * 0.9:
                cur.append(w)
            else:
                labels.append(cur)
                cur = [w]
        labels.append(cur)

    out = []
    for group in labels:
        text = " ".join(w["text"] for w in group).strip()
        box = (
            min(w["x0"] for w in group),
            min(w["top"] for w in group),
            max(w["x1"] for w in group),
            max(w["bottom"] for w in group),
        )
        out.append({"text": text, "box": box, "upright": upright})
    return out


def merge_two_line_labels(labels):
    """Merge label pairs stacked directly on top of each other (wrapped names)."""
    labels.sort(key=lambda l: (l["box"][1], l["box"][0]))
    used = [False] * len(labels)
    merged = []
    for i, a in enumerate(labels):
        if used[i]:
            continue
        ax0, atop, ax1, abottom = a["box"]
        aheight = abottom - atop
        best = None
        for j in range(i + 1, len(labels)):
            if used[j]:
                continue
            b = labels[j]
            bx0, btop, bx1, bbottom = b["box"]
            if btop - abottom > aheight * 0.6:
                if btop - abottom > aheight * 2:
                    break
                continue
            # vertical neighbour with horizontal overlap
            if bx0 <= ax1 and bx1 >= ax0 and abs(btop - abottom) <= aheight * 0.6:
                overlap = min(ax1, bx1) - max(ax0, bx0)
                if overlap >= 0.5 * min(ax1 - ax0, bx1 - bx0):
                    best = j
                    break
        if best is not None:
            used[best] = True
            merged.append(a["text"] + " " + labels[best]["text"])
        else:
            merged.append(a["text"])
        used[i] = True
    return merged


PURE_NUM = re.compile(r"^[\d\s.,()-]+$")


def clean(labels):
    out = []
    for t in labels:
        t = re.sub(r"\s+", " ", t).strip(" .,;:-")
        if not t or PURE_NUM.match(t):
            continue  # census block numbers
        if len(t) < 2:
            continue
        out.append(t)
    return out


def main():
    result = {}
    for island, fname in PDFS.items():
        path = RAW / fname
        with pdfplumber.open(path) as pdf:
            page = pdf.pages[0]
            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
        labels = cluster_words(words)
        merged = merge_two_line_labels(labels)
        cleaned = clean(merged)
        result[island] = cleaned
        print(f"{island}: {len(words)} words -> {len(cleaned)} labels")

    with open(RAW / "mbs_pdf_labels.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    print("wrote data/raw/mbs_pdf_labels.json")


if __name__ == "__main__":
    main()
