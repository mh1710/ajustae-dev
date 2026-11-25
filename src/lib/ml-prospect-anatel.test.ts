import { describe, expect, it } from "vitest";
import { prospectMayHaveRadio } from "./ml-prospect-anatel";

describe("prospectMayHaveRadio", () => {
  it("motor oil has no radio, so Anatel is not applicable", () => {
    expect(prospectMayHaveRadio({ title: "Óleo Para Moto Mobil 10w30 Semissintético 4t 1l", categoryPath: "Acessórios para Veículos > Lubrificantes" })).toBe(false);
  });
  it("pet flea collar has no radio", () => {
    expect(prospectMayHaveRadio({ title: "Coleira Antiparasita Scalibor 65 cm", categoryPath: "Animais > Cães > Antipulgas" })).toBe(false);
  });
  it("a negative Bluetooth attribute does not count", () => {
    expect(prospectMayHaveRadio({ title: "Furadeira de Impacto Bosch 450W", attributes: [{ name: "Com Bluetooth", value_name: "Não" }] })).toBe(false);
  });
  it("Bluetooth in the title requires a real Anatel code", () => {
    expect(prospectMayHaveRadio({ title: "Caixa Portátil Bluetooth JBL Go 3" })).toBe(true);
  });
  it("a positive Wi-Fi attribute requires a real Anatel code", () => {
    expect(prospectMayHaveRadio({ title: "Lâmpada LED E27", attributes: [{ name: "Conectividade", value_name: "Wi-Fi" }] })).toBe(true);
  });
  it("chargers and cellphone categories require a real Anatel code", () => {
    expect(prospectMayHaveRadio({ title: "Carregador Turbo para Celular" })).toBe(true);
    expect(prospectMayHaveRadio({ title: "Capa Protetora", categoryPath: "Celulares e Telefones > Acessórios" })).toBe(true);
  });
});

import { anatelModelTokens, eanVariants, pickOfficialAnatel } from "./ml-prospect-anatel";

describe("Anatel pela base própria", () => {
  it("consulta o EAN com e sem zeros à esquerda", () => {
    expect(eanVariants("07898281903324")).toEqual(expect.arrayContaining(["07898281903324", "7898281903324"]));
  });
  it("usa só códigos de modelo com letras e números", () => {
    const tokens = anatelModelTokens([{ id: "ALPHANUMERIC_MODEL", value_name: "R-F30W" }, { id: "MODEL", value_name: "Carregador Turbo 30W" }], "Carregador 30w Turbo");
    expect(tokens).toContain("RF30W");
    expect(tokens).not.toContain("CARREGADOR");
  });
  it("aceita a homologação oficial só com a mesma marca e um único número", () => {
    expect(pickOfficialAnatel([{ numero: "063891909185", fabricante: "DTimp Comercio" }], "DTimp")).toBe("06389-19-09185");
    expect(pickOfficialAnatel([{ numero: "063891909185", fabricante: "Outra Marca" }], "DTimp")).toBeNull();
    expect(pickOfficialAnatel([{ numero: "063891909185", fabricante: "DTimp" }, { numero: "117472108824", fabricante: "DTimp" }], "DTimp")).toBeNull();
  });
});

describe("Anatel só para quem transmite ou carrega celular", () => {
  it("carregador de bateria de carro, aspirador e nível a laser: não se aplica", () => {
    expect(prospectMayHaveRadio({ title: "Carregador de Bateria 12V 6A Bivolt Inteligente Carro Moto" })).toBe(false);
    expect(prospectMayHaveRadio({ title: "Mini Aspirador De Pó Portátil Recarregável Usb Sem Fio" })).toBe(false);
    expect(prospectMayHaveRadio({ title: "Kit Nível A Laser Verde 12 Linhas" })).toBe(false);
  });
  it("carregador de celular e Bluetooth continuam exigindo código", () => {
    expect(prospectMayHaveRadio({ title: "Carregador 30w Turbo Para iPhone Fonte Usb C" })).toBe(true);
    expect(prospectMayHaveRadio({ title: "Power Bank 20000mah" })).toBe(true);
    expect(prospectMayHaveRadio({ title: "Caixa de Som Bluetooth" })).toBe(true);
  });
});

describe("atributos de uso não contam como rádio", () => {
  it("aspirador com 'Usos recomendados: teclados' é não se aplica", () => {
    expect(prospectMayHaveRadio({ title: "Mini Aspirador Portátil", attributes: [{ name: "Usos recomendados", value_name: "Carros, teclados" }] })).toBe(false);
  });
});
