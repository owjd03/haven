#!/usr/bin/env python3
"""
Build web/backend/data/hotlines.json from Wikipedia (build-time only; the app never scrapes at runtime).

Sources (CC BY-SA 4.0), fetched through the MediaWiki API:
  - https://en.wikipedia.org/wiki/List_of_suicide_crisis_lines
  - https://en.wikipedia.org/wiki/List_of_emergency_telephone_numbers

Every number in the output comes from those pages. Nothing is filled in from memory.

Usage (from this folder):
  python3 -m venv .venv && ./.venv/bin/pip install beautifulsoup4 lxml pycountry
  ./.venv/bin/python build_hotlines.py --fetch      # download + build
  ./.venv/bin/python build_hotlines.py              # rebuild from raw/ without downloading
"""
import datetime
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import pycountry
from bs4 import BeautifulSoup

HERE = Path(__file__).parent
RAW = HERE / "raw"
OUT = HERE.parent.parent / "web" / "backend" / "data" / "hotlines.json"
UA = "HavenHotlineBuilder/1.0 (open-source project; build-time script)"

PAGES = {
    "crisis": "List_of_suicide_crisis_lines",
    "emergency": "List_of_emergency_telephone_numbers",
}
SOURCES = [
    {
        "name": "Wikipedia: List of suicide crisis lines",
        "url": "https://en.wikipedia.org/wiki/List_of_suicide_crisis_lines",
        "license": "CC BY-SA 4.0",
    },
    {
        "name": "Wikipedia: List of emergency telephone numbers",
        "url": "https://en.wikipedia.org/wiki/List_of_emergency_telephone_numbers",
        "license": "CC BY-SA 4.0",
    },
]

# Wikipedia display name -> ISO 3166-1 alpha-2, ONLY where pycountry's own lookup fails.
# (Name-to-code mapping only; no phone data.) Printed for review when used.
NAME_ALIASES = {
    "ivory coast": "CI", "czech republic": "CZ", "east timor": "TL", "burma": "MM", "swaziland": "SZ",
    "the gambia": "GM", "gambia": "GM", "bahamas": "BS", "the bahamas": "BS", "cape verde": "CV",
    "democratic republic of the congo": "CD", "dr congo": "CD", "republic of the congo": "CG",
    "south korea": "KR", "north korea": "KP", "russia": "RU", "syria": "SY", "iran": "IR", "laos": "LA",
    "vietnam": "VN", "bolivia": "BO", "venezuela": "VE", "tanzania": "TZ", "moldova": "MD",
    "palestine": "PS", "state of palestine": "PS", "macau": "MO", "macao": "MO", "hong kong": "HK",
    "taiwan": "TW", "brunei": "BN", "vatican city": "VA", "turkey": "TR", "türkiye": "TR",
    "united states": "US", "united kingdom": "GB", "uk": "GB", "uae": "AE", "kosovo": "XK",
    "federated states of micronesia": "FM", "saint vincent and the grenadines": "VC",
    "saint kitts and nevis": "KN", "saint lucia": "LC", "sao tome and principe": "ST",
    "são tomé and príncipe": "ST", "trinidad and tobago": "TT", "antigua and barbuda": "AG",
    "bosnia and herzegovina": "BA", "north macedonia": "MK", "macedonia": "MK", "eswatini": "SZ",
    "falkland islands": "FK", "faroe islands": "FO", "cayman islands": "KY", "british virgin islands": "VG",
    "u.s. virgin islands": "VI", "us virgin islands": "VI", "northern mariana islands": "MP",
    "cook islands": "CK", "turks and caicos islands": "TC", "saint helena": "SH", "puerto rico": "PR",
    "guam": "GU", "greenland": "GL", "curaçao": "CW", "curacao": "CW", "aruba": "AW", "bermuda": "BM",
    "turkiye": "TR", "united states virgin islands": "VI", "saint martin": "MF", "sint maarten": "SX",
    "svalbard": "SJ", "democratic republic of congo": "CD", "republic of congo": "CG", "micronesia": "FM",
    "republic of china": "TW", "turks and caicos": "TC", "caribbean netherlands": "BQ",
}

# Extra place names people type, mapped to their country, so "I'm in New Jersey" does not match Jersey.
# (Name-to-country only; no phone data.) "georgia" is left to the country.
EXTRA_ALIASES = {
    "US": ["alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware","florida","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana","maine","maryland","massachusetts","michigan","minnesota","mississippi","missouri","montana","nebraska","nevada","new hampshire","new jersey","new mexico","new york","north carolina","north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island","south carolina","south dakota","tennessee","texas","utah","vermont","virginia","washington","west virginia","wisconsin","wyoming","washington dc","usa","u s","u s a","america"],
    "CA": ["ontario","quebec","british columbia","alberta","manitoba","saskatchewan","nova scotia","new brunswick","newfoundland","prince edward island","toronto","vancouver","montreal"],
    "GB": ["england","scotland","wales","northern ireland","great britain","britain","u k","london"],
    "AU": ["new south wales","victoria","queensland","western australia","south australia","tasmania","sydney","melbourne"],
}

# Sub-national rows on the crisis page: folded into their country, with the region kept as a label.
SUBNATIONAL = {
    "england": ("GB", "England"), "scotland": ("GB", "Scotland"), "wales": ("GB", "Wales"),
    "northern ireland": ("GB", "Northern Ireland"), "quebec": ("CA", "Quebec"),
}


def fetch():
    RAW.mkdir(exist_ok=True)
    for key, title in PAGES.items():
        q = urllib.parse.urlencode(
            {"action": "parse", "page": title, "prop": "text", "format": "json", "formatversion": "2", "redirects": "1"}
        )
        req = urllib.request.Request(f"https://en.wikipedia.org/w/api.php?{q}", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            (RAW / f"{key}.json").write_bytes(r.read())
        print("fetched", title)
        time.sleep(1)  # be polite


def soup_of(key):
    html = json.loads((RAW / f"{key}.json").read_text())["parse"]["text"]
    return BeautifulSoup(html, "lxml")


def clean(el):
    for s in el.select("sup.reference, .reference, style, .mw-editsection"):
        s.decompose()
    return re.sub(r"\s+", " ", el.get_text(" ", strip=True)).replace(" ,", ",").replace("( ", "(").replace(" )", ")").strip()


def cell_lines(td):
    """Split a contact cell into separate entries using the page's own structure (<br>, <li>, <p>)."""
    for br in td.find_all("br"):
        br.replace_with("\n")
    for blk in td.find_all(["li", "p", "div"]):
        blk.insert_before("\n")
    for junk in td.select("sup.reference, .reference, style, .mw-editsection"):
        junk.decompose()
    parts = [re.sub(r"\s+", " ", x).strip() for x in td.get_text(" ").split("\n")]
    parts = [x.replace(" ,", ",").replace("( ", "(").replace(" )", ")") for x in parts if x]
    merged = []
    for x in parts:
        digits = len(re.findall(r"\d", x))
        # fragments like "(Press 8)" or "Airtel" belong to the previous number
        if merged and (digits < 3 or x.startswith("(")):
            merged[-1] += " " + x
        else:
            merged.append(x)
    return merged


def country_code(name, unresolved):
    base = re.sub(r"\s*\(.*?\)\s*", " ", name).strip()
    base = re.sub(r"\[.*?\]", "", base).strip()
    key = base.lower()
    if key in NAME_ALIASES:
        return NAME_ALIASES[key], base
    try:
        return pycountry.countries.lookup(base).alpha_2, base
    except LookupError:
        unresolved.add(name)
        return None, base


def name_variants(code, display):
    out = {display}
    try:
        c = pycountry.countries.get(alpha_2=code)
        for attr in ("name", "common_name", "official_name"):
            v = getattr(c, attr, None)
            if v:
                out.add(v)
    except Exception:
        pass
    for k, v in NAME_ALIASES.items():
        if v == code:
            out.add(k)
    out.update(EXTRA_ALIASES.get(code, []))
    return out


def has_digits(s, n=3):
    return len(re.findall(r"\d", s)) >= n


def parse_crisis(unresolved):
    soup = soup_of("crisis")
    by = {}
    skipped = []
    for t in soup.select("table.wikitable"):
        for tr in t.select("tr")[1:]:
            tds = tr.find_all(["td", "th"])
            if len(tds) < 2:
                continue
            a = tds[0].find("a")
            name = clean(tds[0]) if not a else (a.get_text(strip=True) or clean(tds[0]))
            contacts = cell_lines(tds[1])
            label = None
            sub = SUBNATIONAL.get(name.strip().lower())
            if sub:
                code, label = sub
                base = pycountry.countries.get(alpha_2=code).name
            else:
                code, base = country_code(name, unresolved)
            if not code:
                continue
            entry = by.setdefault(code, {"display": base, "contacts": []})
            for contact in contacts:
                if label:
                    contact = f"{label}: {contact}"
                if not has_digits(contact):
                    skipped.append((name, contact))
                    continue
                if contact not in entry["contacts"]:
                    entry["contacts"].append(contact)
            if not entry["contacts"]:
                del by[code]
    return by, skipped


def parse_emergency(unresolved):
    soup = soup_of("emergency")
    out = {}
    for t in soup.select("table.wikitable"):
        for tr in t.select("tr")[1:]:
            tds = tr.find_all(["td", "th"])
            if not tds:
                continue
            cols = []
            for td in tds:
                txt = clean(td)
                cols += [txt] * int(td.get("colspan", 1) or 1)
            if len(cols) < 2:
                continue
            a = tds[0].find("a")
            name = a.get_text(strip=True) if a else cols[0]
            code, _ = country_code(name, unresolved)
            if not code:
                continue
            police, amb, fire = (cols + ["", "", ""])[1:4]
            vals = {k: v[:40] for k, v in (("Police", police), ("Ambulance", amb), ("Fire", fire)) if has_digits(v, 2)}
            if not vals:
                continue
            if len(set(vals.values())) == 1:
                out.setdefault(code, next(iter(vals.values())))
            else:
                out.setdefault(code, ", ".join(f"{k} {v}" for k, v in vals.items()))
    return out


def main():
    if "--fetch" in sys.argv:
        fetch()
    unresolved_c, unresolved_e = set(), set()
    crisis, skipped = parse_crisis(unresolved_c)
    emergency = parse_emergency(unresolved_e)
    today = datetime.date.today().isoformat()

    countries = []
    for code, e in sorted(crisis.items(), key=lambda kv: kv[1]["display"].lower()):
        names = name_variants(code, e["display"])
        display = e["display"]
        countries.append(
            {
                "code": code,
                "name": display,
                "emergency": emergency.get(code, ""),
                "aliases": sorted({n.lower() for n in names if n.lower() != display.lower()}),
                "lines": [
                    {"name": "Crisis / suicide prevention line", "phone": c, "source": SOURCES[0]["url"]}
                    for c in e["contacts"]
                ],
            }
        )
    countries.append(
        {
            "code": "OTHER",
            "name": "Another country",
            "emergency": "",
            "aliases": [],
            "lines": [
                {
                    "name": "International helpline directory",
                    "phone": "",
                    "url": "https://findahelpline.com",
                    "notes": "Lists crisis lines by country.",
                }
            ],
        }
    )
    data = {
        "version": 2,
        "retrievedAt": today,
        "note": (
            "Scraped at build time from the Wikipedia pages listed in `sources` (CC BY-SA 4.0) by tools/hotlines/build_hotlines.py. "
            "Numbers are as listed there, in domestic dialing format, and may be out of date or incomplete. "
            "Verify before relying on them. Can be overridden at runtime via Firebase Remote Config (key: hotlines_json)."
        ),
        "sources": [dict(s, retrievedAt=today) for s in SOURCES],
        "directoryUrl": "https://findahelpline.com",
        "countries": countries,
    }
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")

    n = len(countries) - 1
    with_emerg = sum(1 for c in countries if c["emergency"])
    print(f"wrote {OUT.relative_to(HERE.parent.parent)}: {n} countries with a crisis line, {with_emerg} with an emergency number")
    print("unresolved country names (crisis):", sorted(unresolved_c) or "none")
    print("unresolved country names (emergency):", sorted(unresolved_e) or "none")
    print("rows skipped (no digits):", skipped or "none")


if __name__ == "__main__":
    main()
