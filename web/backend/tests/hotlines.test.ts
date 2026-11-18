import { describe, expect, it } from "vitest";
import { isPlaceholder, LOCAL_HOTLINES, matchCountry, parseHotlines, telNumber } from "../src";

const countries = LOCAL_HOTLINES.countries.filter((c) => c.code !== "OTHER");
const code = (s: string) => matchCountry(s, LOCAL_HOTLINES)?.code;

describe("bundled hotline data (scraped at build time)", () => {
  it("covers well over 150 countries and territories with unique ISO codes", () => {
    expect(countries.length).toBeGreaterThanOrEqual(150);
    const codes = LOCAL_HOTLINES.countries.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of countries) expect(c.code).toMatch(/^[A-Z]{2}$/);
  });

  it("every country has at least one real-looking number, with a source", () => {
    for (const c of countries) {
      expect(c.lines.length, c.code).toBeGreaterThan(0);
      for (const l of c.lines) {
        expect(
          (l.phone ?? "").replace(/\D/g, "").length,
          `${c.code}: ${l.phone}`,
        ).toBeGreaterThanOrEqual(3);
        expect(l.source, c.code).toMatch(/^https:\/\/en\.wikipedia\.org\//);
      }
    }
  });

  it("has no placeholders left and records where and when it came from", () => {
    expect(JSON.stringify(LOCAL_HOTLINES)).not.toMatch(/TODO/i);
    expect(LOCAL_HOTLINES.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(LOCAL_HOTLINES.sources?.length).toBeGreaterThanOrEqual(2);
    for (const s of LOCAL_HOTLINES.sources ?? []) expect(s.license).toMatch(/CC BY-SA/);
  });

  it("regression guard for a few widely known entries", () => {
    const lines = (c: string) =>
      LOCAL_HOTLINES.countries.find((x) => x.code === c)!.lines.map((l) => l.phone);
    expect(lines("US").some((p) => p?.startsWith("988"))).toBe(true);
    expect(lines("AU")).toContain("13 11 14");
    expect(lines("FR")).toContain("3114");
  });

  it("keeps an 'Another country' entry with the international directory", () => {
    const other = LOCAL_HOTLINES.countries.find((c) => c.code === "OTHER");
    expect(other?.lines[0].url).toMatch(/^https:\/\//);
    expect(LOCAL_HOTLINES.directoryUrl).toMatch(/^https:\/\//);
  });
});

describe("matchCountry (string matching only, no model)", () => {
  it("matches typed places", () => {
    expect(code("uk")).toBe("GB");
    expect(code("I'm in Toronto, Canada")).toBe("CA");
    expect(code("u.s.")).toBe("US");
    expect(code("India")).toBe("IN");
    expect(code("Australia please")).toBe("AU");
  });

  it("maps US states and Canadian provinces to their country, not look-alike places", () => {
    expect(code("I'm in New Jersey")).toBe("US");
    expect(code("texas")).toBe("US");
    expect(code("new mexico")).toBe("US");
    expect(code("Ontario")).toBe("CA");
  });

  it("never matches a longer country name by accident (Niger is not Nigeria; Guinea is not Papua New Guinea)", () => {
    expect(code("Nigeria")).toBe("NG");
    expect(code("Papua New Guinea")).toBe("PG");
    // The source list has no entry for Niger or Guinea, so these must not fall into a look-alike.
    expect(code("Niger")).not.toBe("NG");
    expect(code("Guinea")).not.toBe("PG");
  });

  it("does not let short words or ISO codes inside a sentence pick a country", () => {
    expect(code("I'm in Paris")).not.toBe("IN");
    expect(code("it is what it is")).toBeUndefined();
    expect(code("no idea")).toBeUndefined();
    expect(code("IN")).toBe("IN"); // typed alone, an ISO code is fine
  });

  it("returns nothing for empty or unknown input", () => {
    expect(code("")).toBeUndefined();
    expect(code("Atlantis")).toBeUndefined();
  });
});

describe("telNumber (only link what clearly starts with a number)", () => {
  it("extracts the leading number", () => {
    expect(telNumber("988")).toBe("988");
    expect(telNumber("116 123")).toBe("116123");
    expect(telNumber("England: 116 123")).toBe("116123");
    expect(telNumber("0800 58 58 58 (5pm - midnight)")).toBe("0800585858");
    expect(telNumber("8 (495) 989-50-50")).toBe("84959895050");
    expect(telNumber("+1 415 555 0132")).toBe("+14155550132");
    expect(telNumber("999 or 112")).toBe("999");
  });

  it("refuses ambiguous strings rather than guessing", () => {
    expect(telNumber("Police 110, Ambulance 119, Fire 119")).toBeUndefined();
    expect(telNumber("Veterans & Military: Press 1")).toBeUndefined();
    expect(telNumber("")).toBeUndefined();
    expect(telNumber("12")).toBeUndefined();
  });
});

describe("remote hotline validation", () => {
  it("accepts good data and rejects malformed data", () => {
    expect(parseHotlines(JSON.stringify(LOCAL_HOTLINES))).not.toBeNull();
    expect(parseHotlines("not json")).toBeNull();
    expect(parseHotlines({ countries: [] })).toBeNull();
    expect(parseHotlines({ countries: [{ code: 1 }] })).toBeNull();
  });

  it("isPlaceholder still recognises TODO/empty values", () => {
    expect(isPlaceholder("TODO: verify")).toBe(true);
    expect(isPlaceholder("")).toBe(true);
    expect(isPlaceholder("988")).toBe(false);
  });
});
