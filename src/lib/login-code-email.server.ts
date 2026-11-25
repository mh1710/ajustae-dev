// Envio do código de verificação de login. Fica indisponível até o domínio de e-mail ser configurado.
export class LoginCodeEmailUnavailable extends Error {}

export async function sendLoginCodeEmail(_to: string, _code: string, _idempotencyKey: string): Promise<void> {
  throw new LoginCodeEmailUnavailable("O envio de e-mails do sistema ainda não foi configurado.");
}
