import taxonomy from "./ml-taxonomy.json";
const nodes = new Map(taxonomy.map(c => [c.id, c]));
const children = new Map<string, typeof taxonomy>();
const roots = new Map<string, { id: string; path: string }>();
for (const c of taxonomy) {
  roots.set(c.root, { id: c.root, path: c.path.split(' > ')[0] });
  const parentPath = c.path.split(' > ').slice(0, -1).join(' > ');
  const list = children.get(parentPath) ?? [];
  list.push(c); children.set(parentPath, list);
}
export const taxonomyCount = taxonomy.length;
export function browseTaxonomy(search: string, root: string, page: number) {
  const normalize = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const words = normalize(search).split(/\s+/).filter(Boolean);
  const matches = taxonomy.filter(c => (!root || c.root === root) && words.every(w => normalize(c.path + " " + c.id).includes(w)));
  return { rows: matches.slice(page * 50, page * 50 + 50).map(c => ({ id: c.id, path: c.path, leaf: c.leaf })), total: matches.length, count: taxonomyCount, roots: categoryRoots };
}
export function officialCategory(id: string) { return nodes.get(id); }


export const categoryRoots = [...roots.values()];
export function categoryChildren(path:string) { return children.get(path) ?? []; }
export function searchTaxonomy(search:string) {
 const normalize=(v:string)=>v.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 const words=normalize(search).split(/\s+/).filter(Boolean);
 return taxonomy.filter(c=>c.leaf && words.every(w=>normalize(c.path+" "+c.id).includes(w))).slice(0,50).map(c=>({id:c.id,path:c.path}));
}
