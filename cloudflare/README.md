# CDN privado de imagens no Cloudflare

O Worker serve objetos do bucket R2 e expõe uma API administrativa usada somente pelo backend do portal.

URL pública:

```text
https://cdn.seudominio.com/{assinatura}/ajustae/{chave-do-r2}
https://cdn.seudominio.com/v2/{key_id}/{hmac_do_objeto}/{chave_r2_em_base64url}
```

O primeiro formato é legado e permanece somente durante a migração. O formato
v2 assina uma única chave R2, rejeita query strings e usa Base64URL canônico para
evitar ambiguidades de path e percent-encoding.

## Configuração

Os bindings do bucket `IMAGENS`, do KV `ASSINATURAS` e o nome lógico do bucket ficam no `wrangler.toml`.

Crie um segredo forte para a API administrativa:

```powershell
npx wrangler secret put ADMIN_API_TOKEN
npx wrangler secret put CDN_SIGNING_MASTER_CURRENT
```

`CDN_SIGNING_MASTER_CURRENT` deve ter pelo menos 32 caracteres aleatórios. O ID
não secreto correspondente fica em `CDN_SIGNING_MASTER_CURRENT_ID`. Para trocar
o segredo mestre sem interromper links, configure temporariamente
`CDN_SIGNING_MASTER_PREVIOUS` e `CDN_SIGNING_MASTER_PREVIOUS_ID`.

Use exatamente o mesmo valor em `CLOUDFLARE_WORKER_ADMIN_TOKEN` no ambiente do portal. O valor não deve ser incluído no `wrangler.toml` nem enviado ao navegador.

Publique o Worker:

```powershell
npx wrangler deploy
```

## API administrativa

- `GET /__admin/inventory`: pagina o inventário diretamente pelo binding do R2.
- `POST /__admin/signatures`: ativa uma assinatura no KV.
- `DELETE /__admin/signatures/{assinatura}`: revoga uma assinatura.
- `POST /__admin/key-versions`: cria uma versão v2 idempotente.
- `POST /__admin/key-versions/{key_id}/activate|grace|revoking|revoke`: move o
  estado da versão.
- `GET /__admin/key-versions/{key_id}`: reconcilia metadados.
- `POST /__admin/sign`: confirma os objetos no R2 e devolve URLs assinadas.

Todas exigem `Authorization: Bearer <ADMIN_API_TOKEN>`. O portal utiliza essas rotas no servidor; elas nunca devem ser chamadas pelo frontend.

O portal também precisa de `CLOUDFLARE_ZONE_ID` e de um
`CLOUDFLARE_CACHE_PURGE_TOKEN` separado, limitado à permissão Cache Purge da zona
do CDN. Um retorno 200 do purge não conclui a revogação: o job verifica URLs
canário antigas e novas antes de marcar a chave anterior como revogada.
