import { ensureLocalTestEnv, localPath } from "./local-test-env.mjs";

const result = await ensureLocalTestEnv();
if (result.created) {
  console.log(`Criado ${localPath}. Preencha os valores do projeto Supabase de teste.`);
} else if (result.added.length > 0) {
  console.log(`Atualizado ${localPath}. Novas chaves: ${result.added.join(", ")}.`);
} else {
  console.log(`${localPath} ja contem todas as chaves esperadas.`);
}
