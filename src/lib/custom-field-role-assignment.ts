/** Preserve the existing role-to-field storage while editing from a field row. */
export function assignCustomFieldRole(
  roles: Record<string, string>,
  fieldId: string,
  role: string | null,
) {
  const next = { ...roles };
  for (const [key, id] of Object.entries(next)) {
    if (id === fieldId) delete next[key];
  }
  if (role) next[role] = fieldId;
  return next;
}