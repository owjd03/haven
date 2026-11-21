import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyAppearance,
  getFont,
  getTextSize,
  setFont,
  setTextSize,
  setTheme,
} from "../lib/appearance";

const read = (rel: string) => readFileSync(path.join(__dirname, "..", rel), "utf8");

/** A tiny stand-in for the browser: localStorage plus the <html> element's attributes. */
function fakeBrowser() {
  const store = new Map<string, string>();
  const attrs = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const documentElement = {
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
  };
  return { store, attrs, localStorage, documentElement };
}

let b: ReturnType<typeof fakeBrowser>;
beforeEach(() => {
  b = fakeBrowser();
  vi.stubGlobal("window", { localStorage: b.localStorage });
  vi.stubGlobal("document", { documentElement: b.documentElement });
});
afterEach(() => vi.unstubAllGlobals());

describe("text size setting", () => {
  it("is Small by default, with nothing stored", () => {
    expect(getTextSize()).toBe("small");
    expect(b.store.size).toBe(0);
  });

  it("round-trips Smaller, Normal and Larger", () => {
    for (const size of ["large", "normal", "small"] as const) {
      setTextSize(size);
      expect(getTextSize()).toBe(size);
    }
  });

  it("stores Normal and Larger, and Small as nothing saved", () => {
    setTextSize("normal");
    expect(b.store.get("haven.textSize")).toBe("normal");
    setTextSize("small");
    expect(b.store.has("haven.textSize")).toBe(false);
  });

  it("reads anything unrecognised as Small", () => {
    for (const bad of ["huge", "NORMAL", "", "1", "null"]) {
      b.store.set("haven.textSize", bad);
      expect(getTextSize(), bad).toBe("small");
    }
  });

  it("always sets data-text to the size in use", () => {
    for (const size of ["small", "normal", "large"] as const) {
      applyAppearance("light", size);
      expect(b.attrs.get("data-text")).toBe(size);
    }
  });

  it("applies right away when picked, and keeps the colour mode", () => {
    setTheme("dark");
    setTextSize("large");
    expect(b.attrs.get("data-text")).toBe("large");
    expect(b.attrs.get("data-theme")).toBe("dark");
  });

  it("is restored by applyAppearance (used after a backup restore) and back to Small after a wipe", () => {
    b.store.set("haven.textSize", "large");
    applyAppearance();
    expect(b.attrs.get("data-text")).toBe("large");
    b.store.clear(); // what "Delete everything" does to every haven.* key
    applyAppearance();
    expect(b.attrs.get("data-text")).toBe("small");
  });
});

describe("font setting", () => {
  it("is the default font, with nothing stored", () => {
    expect(getFont()).toBe("default");
    expect(b.store.size).toBe(0);
  });

  it("round-trips every choice and stores the default as nothing saved", () => {
    for (const f of ["system", "nunito", "atkinson", "serif"] as const) {
      setFont(f);
      expect(getFont()).toBe(f);
      expect(b.store.get("haven.font")).toBe(f);
      expect(b.attrs.get("data-font")).toBe(f);
    }
    setFont("default");
    expect(b.store.has("haven.font")).toBe(false);
    expect(b.attrs.has("data-font")).toBe(false);
  });

  it("reads anything unrecognised as the default", () => {
    for (const bad of ["comic", "NUNITO", "", "default", "1"]) {
      b.store.set("haven.font", bad);
      expect(getFont(), bad).toBe("default");
    }
  });

  it("keeps the colour mode and size when the font changes", () => {
    setTheme("dark");
    setTextSize("large");
    setFont("nunito");
    expect(b.attrs.get("data-theme")).toBe("dark");
    expect(b.attrs.get("data-text")).toBe("large");
  });

  it("is gone after a wipe", () => {
    setFont("serif");
    b.store.clear();
    applyAppearance();
    expect(b.attrs.has("data-font")).toBe(false);
  });
});

describe("no flash on load: the script in <head> applies the saved choices", () => {
  const source = /const APPEARANCE_INIT = `(.*)`;/.exec(read("app/layout.tsx"))![1];
  const run = (saved: Record<string, string>) => {
    const env = fakeBrowser();
    for (const [k, v] of Object.entries(saved)) env.store.set(k, v);
    new Function("localStorage", "document", source)(env.localStorage, {
      documentElement: env.documentElement,
    });
    return env.attrs;
  };

  it("applies Normal and Larger before first paint", () => {
    expect(run({ "haven.textSize": "normal" }).get("data-text")).toBe("normal");
    expect(run({ "haven.textSize": "large" }).get("data-text")).toBe("large");
  });
  it("starts at Small when nothing or something unknown is saved, and still applies dark mode", () => {
    expect(run({}).get("data-text")).toBe("small");
    expect(run({ "haven.textSize": "huge" }).get("data-text")).toBe("small");
    const both = run({ "haven.theme": "dark", "haven.textSize": "large" });
    expect(both.get("data-theme")).toBe("dark");
    expect(both.get("data-text")).toBe("large");
  });
  it("applies a saved font, and ignores unknown ones", () => {
    for (const f of ["system", "nunito", "atkinson", "serif"]) {
      expect(run({ "haven.font": f }).get("data-font")).toBe(f);
    }
    expect(run({}).has("data-font")).toBe(false);
    expect(run({ "haven.font": "comic" }).has("data-font")).toBe(false);
  });
});

describe("styles", () => {
  const css = read("app/globals.css");

  it("Smaller is 88% of the root, Larger 112.5%, so body text is about 15px, 17px and 19px", () => {
    expect(css).toMatch(/html\[data-text="small"\]\s*\{\s*font-size:\s*88%;/);
    expect(css).toMatch(/html\[data-text="large"\]\s*\{\s*font-size:\s*112\.5%;/);
    const body = /body\s*\{[^}]*font-size:\s*([\d.]+)rem/.exec(css)![1];
    const px = (rootPercent: number) =>
      Math.round(Number(body) * 16 * (rootPercent / 100) * 10) / 10;
    expect(px(88)).toBeGreaterThanOrEqual(15 - 0.1); // never smaller than about 15px
    expect(px(100)).toBe(17);
    expect(px(112.5)).toBeCloseTo(19.1, 1);
  });
});

describe("Settings control", () => {
  it("offers Smaller, Normal and Larger, in that order", () => {
    const src = read("app/settings/AppearanceSettings.tsx");
    const at = (needle: string) => src.indexOf(needle);
    expect(at('label: "Smaller"')).toBeGreaterThan(-1);
    expect(at('label: "Smaller"')).toBeLessThan(at('label: "Normal"'));
    expect(at('label: "Normal"')).toBeLessThan(at('label: "Larger"'));
  });

  it("offers the five fonts, Default first, each shown in its own font", () => {
    const src = read("app/settings/AppearanceSettings.tsx");
    const labels = ["Default", "System", "Nunito", "Atkinson", "Serif"].map((l) =>
      src.indexOf(`label: "${l}"`),
    );
    expect(labels.every((i) => i > -1)).toBe(true);
    expect([...labels].sort((a, c) => a - c)).toEqual(labels);
  });
});

describe("font styles", () => {
  const css = read("app/globals.css");
  it("has a rule for each font, and headings stay in the serif", () => {
    for (const f of ["system", "nunito", "atkinson", "serif"]) {
      expect(css).toContain(`html[data-font="${f}"]`);
    }
    expect(css).toMatch(/h1,\s*h2\s*\{[^}]*font-family:\s*var\(--font-serif\)/);
  });
  it("the system choice uses the device font, never a bundled Apple font", () => {
    expect(css).toMatch(/data-font="system"\]\s*\{[^}]*system-ui, -apple-system/);
  });
});
