# Corrigir e validar o ID na loja por planilha

## Objetivo
Garantir que o campo **Novo ID na Loja** da planilha seja o valor efetivamente gravado no Bling, sem confundi-lo com o ID interno do vínculo.

## Alterações
- Manter o ID interno do vínculo apenas como referência necessária para localizar o anúncio.
- Enviar o conteúdo da coluna **Novo ID na Loja** no campo correto do Bling.
- Depois do envio, consultar novamente o vínculo no Bling e só considerar a linha concluída se o valor retornado for igual ao da planilha.
- Atualizar o valor no Ajustta-Ê somente após essa confirmação; em caso de divergência, registrar erro para reprocessamento em vez de mostrar sucesso.

## Validação
- Testar com o SKU `E380293`, loja KABUM (`205560616`) e valor esperado `E380293`.
- Confirmar que o ID interno do vínculo nunca é salvo como ID na loja.
- Verificar compilação e erros da aplicação.
