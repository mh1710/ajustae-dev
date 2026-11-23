import { supabase } from '@/integrations/supabase/client';
// App-owned accounts keep company scope in the database, never in browser claims.
export async function getCompanySession() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { data: roles, error: roleError } = await supabase.from('user_roles').select('role').eq('user_id', data.user.id);
  if (roleError) throw new Error('Não foi possível conferir seu acesso.');
  return { user: data.user, restricted: (roles ?? []).some(row => String(row.role) === 'company_viewer') };
}