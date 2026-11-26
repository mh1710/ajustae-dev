import { describe, expect, it } from "vitest";
import { descriptionPlainText, descriptionVisibleLength } from "./description-text";

describe("descriptionPlainText", () => {
  it("remove HTML e decodifica entidades antes de medir", () => {
    expect(descriptionPlainText("<p>Furadeira&nbsp;500W</p><br><b>127V &amp; reversível</b>")).toBe(
      "Furadeira 500W 127V & reversível",
    );
  });

  it("não conta tags HTML como caracteres visíveis", () => {
    expect(descriptionVisibleLength("<strong>ABC</strong><br>DEF")).toBe(7);
  });
});
