import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reportsDir = resolve(root, "tests/unit/reports");
const jsonPath = resolve(reportsDir, "latest.json");
const markdownPath = resolve(reportsDir, "latest.md");
mkdirSync(reportsDir, { recursive: true });

const safeEnv = { ...process.env };
for (const name of Object.keys(safeEnv)) {
  if (
    /^(?:BLING|SUPABASE|CLOUDFLARE|CDN|R2|NYLAS|NANGO)_.+(?:KEY|TOKEN|SECRET|PASSWORD|URL)$/i.test(
      name,
    )
  ) {
    delete safeEnv[name];
  }
}
safeEnv.NODE_ENV = "test";
safeEnv.BLING_RUNTIME_ENV = "unit_test";
safeEnv.VITE_SUPABASE_URL = "http://127.0.0.1:9";
safeEnv.VITE_SUPABASE_ANON_KEY = "unit-test-placeholder";

const run = spawnSync(
  process.execPath,
  [
    resolve(root, "node_modules/vitest/vitest.mjs"),
    "run",
    "--config",
    "tests/unit/vitest.config.ts",
    "--reporter=json",
    `--outputFile=${jsonPath}`,
  ],
  {
    cwd: root,
    env: safeEnv,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  },
);

let report;
try {
  report = JSON.parse(readFileSync(jsonPath, "utf8"));
} catch {
  const diagnostic = [run.error?.stack, run.stdout, run.stderr].filter(Boolean).join("\n").trim();
  writeFileSync(
    markdownPath,
    `# Testes unitários Ajustae\n\nFalha ao gerar o relatório JSON.\n\n\`\`\`text\n${diagnostic}\n\`\`\`\n`,
  );
  console.error(`Falha ao iniciar a suíte. Consulte ${markdownPath}`);
  process.exit(run.status ?? 1);
}

const testResults = Array.isArray(report.testResults) ? report.testResults : [];
const normalizedRoot = root.replaceAll("\\", "/");
const failures = testResults.flatMap((suite) =>
  (suite.assertionResults ?? [])
    .filter((test) => test.status === "failed")
    .map((test) => ({
      file: String(suite.name ?? "")
        .replaceAll("\\", "/")
        .replace(`${normalizedRoot}/`, ""),
      title: test.fullName ?? test.title ?? "Teste sem nome",
      messages: test.failureMessages ?? [],
    })),
);
const readSource = (relativePath) => readFileSync(resolve(root, relativePath), "utf8");
const cdnImagesSource = readSource("src/lib/cdn-images.server.ts");
const blingPushSource = readSource("src/lib/bling-push.server.ts");
const customFieldsSource = readSource("src/lib/bling-custom-fields.server.ts");
const customFieldSuccessBlock = customFieldsSource.slice(
  customFieldsSource.indexOf("if (r.ok)"),
  customFieldsSource.indexOf("} else {", customFieldsSource.indexOf("if (r.ok)")),
);
const architectureFindings = [
  {
    id: "AJS-001",
    severity: "alta",
    detected:
      cdnImagesSource.includes("url_imagens_externas: urls.join") &&
      !cdnImagesSource.includes("blingApiRequest"),
    title: "A propagação CDN altera o produto local sem chamada de escrita ao Bling.",
    file: "src/lib/cdn-images.server.ts",
  },
  {
    id: "AJS-002",
    severity: "média",
    detected: blingPushSource.includes("if (res.ok) await saveProductSnapshot"),
    title: "O PATCH comum salva o snapshot após HTTP de sucesso, sem GET de confirmação.",
    file: "src/lib/bling-push.server.ts",
  },
  {
    id: "AJS-003",
    severity: "alta",
    detected:
      blingPushSource.includes("local?.bling_product_id") &&
      blingPushSource.includes("ok:true, status:200"),
    title:
      "A criação pode usar um ID local como sucesso sintético sem confirmar que o produto existe no Bling.",
    file: "src/lib/bling-push.server.ts",
  },
  {
    id: "AJS-004",
    severity: "média",
    detected:
      customFieldSuccessBlock.includes("dirty: false") &&
      !customFieldSuccessBlock.includes("blingApiGet"),
    title: "Campo customizado fica limpo localmente após PATCH, sem leitura de confirmação.",
    file: "src/lib/bling-custom-fields.server.ts",
  },
  {
    id: "AJS-005",
    severity: "média",
    detected:
      blingPushSource.includes("Nada mudou: conclui sem chamar o Bling") &&
      blingPushSource.includes("status: 0"),
    title: "Snapshot local igual encerra a fila sem conferir eventual divergência no Bling.",
    file: "src/lib/bling-push.server.ts",
  },
].filter((finding) => finding.detected);
const now = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "medium",
  timeZone: "America/Sao_Paulo",
}).format(new Date());
const pendingContracts = Number(report.numPendingTests ?? 0) + Number(report.numTodoTests ?? 0);
const lines = [
  "# Relatório de testes unitários Ajustae",
  "",
  `Gerado em ${now} (America/Sao_Paulo).`,
  "",
  `- Suítes: ${report.numPassedTestSuites ?? 0} aprovadas, ${report.numFailedTestSuites ?? 0} com falha, ${report.numTotalTestSuites ?? testResults.length} no total`,
  `- Testes: ${report.numPassedTests ?? 0} aprovados, ${report.numFailedTests ?? failures.length} com falha, ${report.numTotalTests ?? 0} no total`,
  `- Contratos pendentes: ${pendingContracts}`,
  `- Execução: ${run.status === 0 ? "APROVADA" : "REPROVADA"}`,
  "- Rede e credenciais reais: bloqueadas pela configuração unitária",
  "",
];
if (failures.length) {
  lines.push("## Falhas", "");
  for (const failure of failures) {
    lines.push(`### ${failure.title}`, "", `Arquivo: \`${failure.file}\``, "");
    for (const message of failure.messages) {
      lines.push("```text", String(message).slice(0, 4000), "```", "");
    }
  }
} else {
  lines.push("Nenhuma falha encontrada nesta execução.", "");
}
if (architectureFindings.length) {
  lines.push(
    "## Alertas arquiteturais para discussão",
    "",
    "São heurísticas sobre o código, não defeitos confirmados. Cada alerta possui um teste pendente correspondente.",
    "",
  );
  for (const finding of architectureFindings) {
    lines.push(
      `- **${finding.id} · risco ${finding.severity}:** ${finding.title} (\`${finding.file}\`)`,
    );
  }
  lines.push("");
}
writeFileSync(markdownPath, `${lines.join("\n")}\n`);

console.log(
  `Testes Ajustae: ${report.numPassedTests ?? 0} aprovados, ${report.numFailedTests ?? failures.length} falharam, ${architectureFindings.length} alertas. Relatório: ${markdownPath}`,
);
process.exit(run.status ?? 1);
