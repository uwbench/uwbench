import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPixelFont } from "./pixel-font.js";

describe("pixel font", () => {
  it("reads the hearth statement page", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL(
          "../../../benchmark/raw-documents-v0.1/public-cases/case-raw-hearth/environment/tool-fixtures.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as {
      documents: { pages: { imagePngBase64?: string }[] }[];
    };
    const png = Buffer.from(
      fixture.documents[0]!.pages[0]!.imagePngBase64 ?? "",
      "base64",
    );
    const text = readPixelFont(png);
    expect(text).toContain("REVENUE USD 1640000");
    expect(text).toContain("EBITDA USD 220000");
    expect(text).toContain("BENCHMARK-FROZEN FIGURES");
    expect(text).not.toContain("?");
  });
});
