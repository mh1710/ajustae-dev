import { loadAndValidateLocalTestEnv, safeEnvironmentSummary } from "./local-test-env.mjs";

const values = await loadAndValidateLocalTestEnv();
console.log(JSON.stringify(safeEnvironmentSummary(values), null, 2));
console.log("Ambiente local de teste validado. Nenhum secret foi exibido.");
