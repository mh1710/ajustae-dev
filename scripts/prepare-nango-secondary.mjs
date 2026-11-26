const apiBase = (process.env.NANGO_API_URL || "https://api.nango.dev").replace(/\/$/, "");
const apiKey = (process.env.NANGO_API_KEY_SECONDARY || "").trim();
const integrationId = (process.env.NANGO_SECONDARY_GMAIL_INTEGRATION_ID || "google-mail").trim();
const shouldCreate = process.argv.includes("--create");

if (!apiKey) {
  console.error(
    "Configure NANGO_API_KEY_SECONDARY no .env.local com a Secret Key do segundo ambiente Nango.",
  );
  process.exit(1);
}

async function nango(path, init) {
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text.slice(0, 500) };
    }
  }
  if (!response.ok) {
    const message =
      payload?.error?.message ||
      payload?.error?.code ||
      payload?.message ||
      `HTTP ${response.status}`;
    throw new Error(`Nango recusou a operação (${response.status}): ${message}`);
  }
  return payload;
}

function integrationList(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.integrations)) return payload.integrations;
  return [];
}

let integrations = integrationList(await nango("/integrations"));
let gmail = integrations.find((item) => item?.unique_key === integrationId);

if (!gmail && shouldCreate) {
  const created = await nango("/integrations", {
    method: "POST",
    body: JSON.stringify({
      provider: "google-mail",
      unique_key: integrationId,
      display_name: "Gmail — Ajusta-Ê",
      credentials: { type: "NANGO_MANAGED" },
    }),
  });
  gmail = created?.data;
  integrations = integrationList(await nango("/integrations"));
  gmail = integrations.find((item) => item?.unique_key === integrationId) || gmail;
}

if (!gmail) {
  console.error(
    `A integração ${integrationId} ainda não existe no segundo ambiente. Execute novamente com --create ou crie-a no painel Nango.`,
  );
  process.exit(1);
}

if (gmail.provider !== "google-mail") {
  console.error(
    `A integração ${integrationId} usa o provedor ${gmail.provider || "desconhecido"}, não google-mail.`,
  );
  process.exit(1);
}

const missingFields = Array.isArray(gmail.missing_fields) ? gmail.missing_fields : [];
if (missingFields.length) {
  console.error(`A integração existe, mas faltam credenciais: ${missingFields.join(", ")}.`);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      api_url: apiBase,
      integration_id: gmail.unique_key,
      provider: gmail.provider,
      integration_count: integrations.length,
      secret_exposed: false,
    },
    null,
    2,
  ),
);
console.log("Segundo ambiente Nango pronto para receber conexões Gmail no Ajusta-Ê.");
