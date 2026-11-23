import assert from "node:assert/strict";
import test from "node:test";
import {
  extractWebContinentalCode,
  matchesAllowedEmailSender,
  matchesWebContinentalTokenSubject,
} from "./email-code-parser.ts";

const subject = "WebContinental Marketplace - Token de acesso";

test("extrai código numérico identificado em HTML", () => {
  assert.equal(
    extractWebContinentalCode({
      subject,
      body: "<p>Seu código é <strong>834921</strong></p>",
    }),
    "834921",
  );
});

test("extrai token alfanumérico identificado", () => {
  assert.equal(extractWebContinentalCode({ subject, body: "Token: WC82K9" }), "WC82K9");
});

test("extrai token somente com letras no modelo real da WebContinental", () => {
  assert.equal(
    extractWebContinentalCode({
      subject: `Aviso: ${subject}`,
      body: `
        <p>Olá <strong>hmatheus917@gmail.com</strong>, recebemos uma solicitação.</p>
        <p>O seu token de acesso é</p>
        <p><strong>XXXXX</strong></p>
      `,
    }),
    "XXXXX",
  );
});

test("não aceita números sem rótulo de autenticação", () => {
  assert.equal(
    extractWebContinentalCode({ subject, body: "Pedido 834921 recebido em 12/11/2026." }),
    null,
  );
});

test("recusa token quando o assunto não é o oficial", () => {
  assert.equal(extractWebContinentalCode({ subject: "Outro aviso", body: "Token: WC82K9" }), null);
});

test("reconhece o assunto com prefixo, espaços e travessão", () => {
  assert.equal(
    matchesWebContinentalTokenSubject(`Re: WebContinental Marketplace — Token de acesso`),
    true,
  );
  assert.equal(
    matchesWebContinentalTokenSubject("WebContinental Marketplace - Pedido recebido"),
    false,
  );
});

test("valida endereço exato e domínio permitido", () => {
  assert.equal(
    matchesAllowedEmailSender("auth@webcontinental.com.br", ["webcontinental.com.br"]),
    true,
  );
  assert.equal(
    matchesAllowedEmailSender("auth@sub.webcontinental.com.br", ["webcontinental.com.br"]),
    true,
  );
  assert.equal(matchesAllowedEmailSender("fraude@example.com", ["webcontinental.com.br"]), false);
  assert.equal(matchesAllowedEmailSender("codigo@parceiro.com", ["codigo@parceiro.com"]), true);
});
