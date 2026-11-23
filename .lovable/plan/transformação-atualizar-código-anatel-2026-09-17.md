# Transformação "Atualizar Código Anatel"

Nova transformação que mexe **apenas** na parte da Anatel dentro da descrição curta. Garantia, Anvisa e todo o resto do texto ficam exatamente como estão.

## Como vai funcionar

Para cada produto selecionado (ou todos da empresa):

1. Busca o código na base ANATEL pelo SKU do produto.
2. Se não encontrar, usa `isento`.
3. Procura na descrição curta se já existe "Código Anatel: ...".
   - Existe: troca só o valor pelo da base (sempre atualiza).
   - Não existe: acrescenta `Código Anatel: <código>` no final, junto do bloco de Garantia/Anvisa quando houver, sem duplicar linhas.
4. Só grava o produto se o texto realmente mudou, marcando-o para reenvio ao Bling.

No fim aparece um aviso com quantos produtos foram atualizados.

## Onde aparece

- Na lista de produtos, no menu de transformações, uma nova opção: **"Atualizar Código Anatel (só esse campo)"**, ao lado das opções já existentes de Garantia + Anatel.
- Funciona tanto para os produtos selecionados quanto para todos da empresa, igual às outras transformações.

## Detalhes técnicos

- Nova migração em `db/migrations/` criando `public.transform_update_anatel_code(_company_id uuid, _product_ids uuid[] default null)`:
  - `SECURITY DEFINER`, `search_path = public`, `statement_timeout = 0`, com a mesma checagem de `company_users` usada em `transform_fill_garantia_anatel`.
  - `LEFT JOIN public.anatel_products a ON btrim(a.codigo) = btrim(coalesce(p.codigo,''))`, código final `coalesce(nullif(btrim(a.codigo_anatel),''), 'isento')`.
  - Substituição in-place via `regexp_replace(desc, '(Código\s+Anatel\s*:\s*)[^\n\r|]*', '\1' || code, 'gi')` quando a expressão existir; caso contrário concatena o trecho preservando o separador ` | ` se a linha final já tiver Garantia/Anvisa, ou em nova linha caso contrário.
  - `UPDATE ... SET descricao_curta, dirty = true, updated_at = now()` apenas onde o texto mudou; retorna `jsonb_build_object('updated', n)`.
- `src/lib/products-tools.functions.ts`: novo server fn `transformUpdateAnatelCode` (mesmo formato de `transformFillGarantiaAnatel`, chamando a nova RPC).
- `src/routes/_authenticated/produtos.tsx`: novo handler `onUpdateAnatelCode` + item no painel de transformações, com toast de quantidade atualizada.
- Após a migração, regenerar/estender os tipos do Supabase para a nova RPC se necessário; typecheck e build no fim.
