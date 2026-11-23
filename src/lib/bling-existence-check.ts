/** Pure response classifier: absence requires Bling's structured not-found response, never generic HTML or empty results. */
export type ExistenceResponse = {ok:boolean;status:number;data?:unknown;responseBodySafe?:string;errorMessage?:string};
export function isConfirmedMissing(r:ExistenceResponse) {
 if(r.ok || r.status!==404) return false;
 try {
  const body=JSON.parse(r.responseBodySafe ?? '') as {error?:{type?:string;message?:string;description?:string}};
  return body.error?.type==='RESOURCE_NOT_FOUND' && /encontr|found|exist/i.test((body.error.message ?? '')+' '+(body.error.description ?? ''));
 } catch { return false; }
}
export function hasMatchingProduct(r:ExistenceResponse,id:string) {
 if(!r.ok || !r.data || typeof r.data!=='object') return false;
 const payload=r.data as {data?:{id?:string|number}};
 return String(payload.data?.id ?? '')===id;
}
