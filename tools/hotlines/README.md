# Hotline data builder

`build_hotlines.py` generates `web/backend/data/hotlines.json` at **build time** (the app never scrapes at runtime).

Sources, via the MediaWiki API (CC BY-SA 4.0, attribution is stored in the output):
- [List of suicide crisis lines](https://en.wikipedia.org/wiki/List_of_suicide_crisis_lines)
- [List of emergency telephone numbers](https://en.wikipedia.org/wiki/List_of_emergency_telephone_numbers)

Every number comes from those pages; nothing is filled in from memory. Sub-national rows (England, Scotland, Wales, Northern Ireland, Quebec) are folded into their country with the region as a label. Country names are mapped to ISO codes with `pycountry` plus a small alias table (names only, no phone data).

```bash
cd tools/hotlines
python3 -m venv .venv && ./.venv/bin/pip install beautifulsoup4 lxml pycountry
./.venv/bin/python build_hotlines.py --fetch   # download from Wikipedia, then build
./.venv/bin/python build_hotlines.py           # rebuild from raw/ without downloading
```

`raw/` and `.venv/` are gitignored. Re-run periodically, because numbers change. Limits: Wikipedia can be out of date, and cells with several numbers are split only where the page itself separates them.
