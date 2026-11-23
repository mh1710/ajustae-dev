import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { processSupplierSyncTick } from "@/lib/bling-suppliers.server";
const db = supabaseAdmin as any;
const { data: job } = await db.from("bling_supplier_sync_jobs").select("id").eq("company_id","5d8bcd36-8941-40ae-a3e1-2cd14f4e85bf").eq("status","executando").order("created_at",{ascending:false}).limit(1).single();
for (let i = 0; i < 200; i++) {
  const r = await processSupplierSyncTick(job.id, 40_000);
  const { data: j } = await db.from("bling_supplier_sync_jobs").select("status,phase,details_checked,links_found,last_error").eq("id", job.id).single();
  console.log(new Date().toISOString(), JSON.stringify(r), JSON.stringify(j));
  if (r.done) break;
  if ((r as any).busy) await new Promise((x) => setTimeout(x, 15000));
}
console.log("FIM");
