export const COMPANY_ROUTES = ['/produtos', '/bi', '/auditoria', '/regras-validacao', '/integracoes', '/codigos-email', '/configuracoes'] as const;
const allowed: Record<string, readonly string[]> = {
  'repasses.functions.ts': ['listRepasses', 'saveRepasse', 'deleteRepasse'],
  'access.functions.ts': ['getMyAccess'],
  'companies.functions.ts': ['listMyCompanies'],
  'sync-lock.functions.ts': ['getActiveSyncLock'],
  'bling.functions.ts': ['listBlingIntegrations', 'getBlingRuntimeEnvironment'],
  'bling-sync.functions.ts': ['listProducts', 'listProductIds', 'getActiveOrLatestSync'],
  'products-tools.functions.ts': ['getProduct', 'getProductBySku'],
  'audit.functions.ts': ['listValidationRules', 'startAuditRun', 'runAuditBatch', 'cancelAuditRun', 'getAuditRun', 'listAuditRuns', 'getProductAuditResults', 'listAuditIssueTypes', 'auditSingleProduct', 'listAuditRunResults'],
  'bi.functions.ts': ['startOrdersSync', 'getOrdersSyncStatus', 'listOrdersSyncHistory', 'getSalesKpis', 'getDreReport', 'listOrders', 'getOrderDetail', 'listDreExpenses', 'saveDreExpense', 'deleteDreExpense'],
  'suppliers.functions.ts': ['getAlternativeSuppliers', 'listSuppliers'],
  'mercadolivre.functions.ts': ['getMlSupplierQuote', 'getCompanyCatalogStatus'],
  'bling-stores.functions.ts': ['listProductStores', 'getStoreCountsForProducts', 'listBlingChannels', 'listDistinctStores', 'getBlingStoresProgress'],
  'bling-existence.functions.ts': ['getExistenceJob'],
  'ai-jobs.functions.ts': ['listAiTransformJobs'],
  'pricing.functions.ts': ['getPricingPolicyStatus'],
  'email-connector.functions.ts': [
    'getEmailConnectorConfig',
    'startEmailConnection',
    'listEmailDashboard',
    'revealEmailCode',
    'markEmailCodeUsed',
    'disconnectEmailConnection',
    'syncEmailConnection',
  ],
};
export function isCompanyFunctionAllowed(filename: string, name: string) {
  return allowed[filename.replaceAll('\\', '/').split('/').pop() ?? '']?.includes(name) ?? false;
}
export function isCompanyRouteAllowed(pathname: string) {
  return COMPANY_ROUTES.some(route => pathname === route || (route === '/produtos' && pathname.startsWith('/produtos/')));
}
