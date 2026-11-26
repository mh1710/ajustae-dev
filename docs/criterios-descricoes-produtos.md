# Critérios de descrições de produtos

## Tipos de texto

| Campo                   | Finalidade                                              | Critério principal                                                                 |
| ----------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Nome / título           | Identificação e busca                                   | Até 60 caracteres; tipo do produto, marca, modelo e variação correta.              |
| Descrição curta         | Conteúdo comercial enviado ao Bling                     | Mínimo de 150 caracteres visíveis; recomendado entre 150 e 230; texto puro.        |
| Descrição complementar  | Identificação complementar exigida pela auditoria atual | Deve ser exatamente igual ao nome/título, desconsiderando espaços nas pontas.      |
| Descrição do fornecedor | Texto do vínculo produto-fornecedor                     | Nome reconhecível do item no fornecedor; o envio ao Bling limita a 120 caracteres. |
| Observações             | Informação operacional adicional                        | Apenas informação verdadeira e necessária; sem HTML.                               |
| Informações adicionais  | Dados complementares não comerciais                     | Texto puro, factual e sem repetir o título ou o rodapé.                            |

## Estrutura recomendada da descrição curta

1. Comece pelo tipo do produto.
2. Informe marca e modelo.
3. Inclua somente especificações confirmadas: potência, capacidade, voltagem,
   cor, tamanho, material, quantidade e compatibilidade exata.
4. Descreva benefícios apenas quando forem consequência direta de uma
   característica confirmada.
5. Termine com um único rodapé:

```text
Garantia: 3 meses | Código Anatel: CÓDIGO_OU_ISENTO | Anvisa: Isento
```

## Critérios por tipo de produto

| Tipo | Dados que a descrição deve priorizar |
| --- | --- |
| Eletrônico / telecom | Marca, modelo, conectividade, alimentação ou voltagem, potência, compatibilidade e código Anatel confirmado. |
| Eletrodoméstico / elétrico | Capacidade, potência, voltagem, consumo quando confirmado, dimensões e itens inclusos. |
| Peça / reposição / acessório | Modelos exatamente compatíveis, medida, encaixe, material, quantidade e o que acompanha. Não use “universal” sem comprovação. |
| Áudio / instrumento | Potência, impedância, conexões, resposta de frequência e compatibilidade, somente quando constarem na ficha técnica. |
| Casa / móvel | Material, cor, dimensões montadas, capacidade ou peso suportado e necessidade de montagem. |
| Moda / calçado | Material, cor, tamanho, modelagem e medidas da variação. Não misture grade ou cor de outra variação. |
| Kit / conjunto | Quantidade total e relação exata dos componentes; deixe claro o que não acompanha quando isso evitar ambiguidade. |
| Cosmético / saúde | Conteúdo líquido, apresentação, composição e uso apenas conforme fonte oficial; informe registro ou isenção Anvisa comprovada. Não faça alegação médica. |

Se um produto se encaixar em mais de um tipo, combine apenas os critérios
pertinentes e confirmados para aquela variação.

## Regras obrigatórias

- Conte pelo menos 150 caracteres depois de remover tags e decodificar
  entidades HTML.
- Use texto puro e quebras de linha; não use `<br>`, `<p>`, tabelas ou outros
  elementos HTML.
- Não invente função, medida, material, compatibilidade, certificação, EAN,
  garantia ou código regulatório.
- Preserve exatamente marca, modelo, voltagem, cor, capacidade e variação.
- Não misture dados de produtos diferentes ou de anúncios com outro EAN.
- Não inclua preço, promoção, frete, prazo de entrega, telefone, e-mail ou link.
- Não repita palavras-chave artificialmente.
- Use uma única ocorrência do rodapé e uma única ocorrência da palavra
  `Garantia`.
- Produtos sujeitos à Anatel precisam do código exato da própria variação.
  Quando comprovadamente não aplicável, use `Isento`/`Não se aplica` conforme
  a configuração regulatória da empresa.

## Fontes permitidas para produtos novos

Use, nesta ordem:

1. ficha técnica do fornecedor;
2. outro cadastro validado com o mesmo EAN;
3. catálogo do Mercado Livre com o mesmo EAN;
4. atributos do mesmo produto e da mesma variação.

Se a fonte não confirmar uma informação, deixe-a ausente para revisão. Um
texto genérico e correto é preferível a uma descrição específica inventada.
