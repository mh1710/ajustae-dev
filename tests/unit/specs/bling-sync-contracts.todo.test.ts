import { describe, it } from "vitest";

describe("contratos banco local versus Bling", () => {
  it.todo("AJS-001: propagação CDN só conclui após PATCH e GET de confirmação no Bling");
  it.todo("AJS-002: snapshot de produto só avança após conferir o estado remoto");
  it.todo("AJS-003: ID local de produto é validado no Bling antes de simular sucesso de criação");
  it.todo("AJS-004: campo customizado só fica dirty=false após confirmação remota");
  it.todo("AJS-005: fila sem diff detecta divergência entre snapshot local e Bling");
});
