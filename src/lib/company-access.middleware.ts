import { createMiddleware } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { createClient } from '@supabase/supabase-js';
import { isCompanyFunctionAllowed } from './company-access-policy';

// Default-deny for restricted accounts, including calls made outside the UI.
export const enforceCompanyAccess = createMiddleware({ type: 'function' }).server(async ({ next, serverFnMeta }) => {
  const authorization = getRequest().headers.get('authorization');
  if (!authorization) {
    if (serverFnMeta.filename.endsWith('/bling.functions.ts') && serverFnMeta.name === 'getBlingCallbackUrlForDisplay') return next();
    throw new Error('É necessário entrar para acessar esta função.');
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('Configuração de acesso indisponível.');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authorization } } });
  const { data, error } = await client.auth.getUser(authorization.replace(/^Bearer /, ''));
  if (error || !data.user) throw new Error('Sessão inválida.');
  const roles = await client.from('user_roles').select('role').eq('user_id', data.user.id);
  if (roles.error) throw new Error('Não foi possível conferir as permissões.');
  const restricted = roles.data.some(row => String(row.role) === 'company_viewer');
  if (restricted && !isCompanyFunctionAllowed(serverFnMeta.filename, serverFnMeta.name)) {
    throw new Error('Este acesso permite somente consulta de produtos, regras e integração, auditorias e BI/DRE.');
  }
  return next();
});