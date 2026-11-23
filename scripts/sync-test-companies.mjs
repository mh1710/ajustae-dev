import { createClient } from "@supabase/supabase-js";
import { loadAndValidateLocalTestEnv } from "./local-test-env.mjs";

const values = await loadAndValidateLocalTestEnv({ requireSource: true });
const source = createClient(values.SOURCE_SUPABASE_URL, values.SOURCE_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const target = createClient(values.SUPABASE_URL, values.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findTargetUser(email) {
  const wanted = email.trim().toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await target.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Falha ao consultar usuarios do projeto de teste: ${error.message}`);
    const match = data.users.find((user) => user.email?.trim().toLowerCase() === wanted);
    if (match) return match;
    if (data.users.length < 200) break;
  }
  throw new Error(`Crie primeiro o usuario ${email} no Supabase de teste e execute novamente.`);
}

const testUser = await findTargetUser(values.TEST_ADMIN_EMAIL);
const { error: adminRoleError } = await target
  .from("user_roles")
  .upsert({ user_id: testUser.id, role: "admin" }, { onConflict: "user_id,role" });
if (adminRoleError) {
  throw new Error(`Falha ao promover o usuario no projeto de teste: ${adminRoleError.message}`);
}
const { data: companies, error: companiesError } = await source
  .from("companies")
  .select("id,nome,nome_fantasia,cnpj,status")
  .order("created_at", { ascending: true });
if (companiesError) throw new Error(`Falha ao ler empresas de origem: ${companiesError.message}`);
if (!companies?.length) throw new Error("Nenhuma empresa foi encontrada no projeto de origem.");

const companyRows = companies.map((company) => ({
  id: company.id,
  nome: company.nome,
  nome_fantasia: company.nome_fantasia,
  cnpj: company.cnpj,
  status: company.status,
  owner_user_id: testUser.id,
}));
const { error: companyUpsertError } = await target
  .from("companies")
  .upsert(companyRows, { onConflict: "id" });
if (companyUpsertError) {
  throw new Error(`Falha ao gravar empresas no projeto de teste: ${companyUpsertError.message}`);
}

const membershipRows = companies.map((company) => ({
  company_id: company.id,
  user_id: testUser.id,
  role: "admin",
  ativo: true,
}));
const { error: membershipError } = await target
  .from("company_users")
  .upsert(membershipRows, { onConflict: "company_id,user_id" });
if (membershipError) {
  throw new Error(`Falha ao vincular o administrador de teste: ${membershipError.message}`);
}

const companyIds = companies.map((company) => company.id);
const { data: existingIntegrations, error: integrationReadError } = await target
  .from("bling_integrations")
  .select("company_id")
  .in("company_id", companyIds);
if (integrationReadError) {
  throw new Error(`Falha ao consultar integracoes de teste: ${integrationReadError.message}`);
}
const existingIds = new Set((existingIntegrations ?? []).map((row) => row.company_id));
const missingIntegrations = companyIds
  .filter((companyId) => !existingIds.has(companyId))
  .map((companyId) => ({ company_id: companyId, status: "desconectada" }));
if (missingIntegrations.length > 0) {
  const { error: integrationInsertError } = await target
    .from("bling_integrations")
    .insert(missingIntegrations);
  if (integrationInsertError) {
    throw new Error(
      `Falha ao criar integracoes vazias de teste: ${integrationInsertError.message}`,
    );
  }
}

console.log(
  JSON.stringify(
    {
      companies_copied: companies.length,
      integrations_created: missingIntegrations.length,
      test_admin: values.TEST_ADMIN_EMAIL,
      test_admin_role_ensured: true,
      copied_credentials: false,
      copied_tokens: false,
      copied_products: false,
      copied_jobs: false,
    },
    null,
    2,
  ),
);
