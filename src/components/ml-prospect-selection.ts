type ProspectPage = { rows: Array<{ id: unknown }>; total: number };

/** Fetch every existing candidate, independently of the visible 200-row page. */
export async function loadAllProspectIds(
  fetchPage: (page: number, pageSize: number) => Promise<ProspectPage>,
): Promise<Set<string>> {
  const ids = new Set<string>();
  const pageSize = 200;
  for (let page = 1; ; page++) {
    const result = await fetchPage(page, pageSize);
    for (const row of result.rows) ids.add(String(row.id));
    if (page * pageSize >= result.total) return ids;
    if (result.rows.length === 0) throw new Error("Não foi possível carregar todos os produtos. Tente novamente.");
  }
}