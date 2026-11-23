import { test, expect, mock, beforeEach } from 'bun:test';

const calls: {method:string;path:string;body:any}[] = [];
const updates: any[] = [];
let localId: string | null = null;
let confirmationFails = false;
let savedLinks = 0;
const product = { company_id:'destination',source:'copia_empresa',codigo:'HA73145',nome:'Produto',preco_custo:75.6 };
const supplier = { bling_supplier_id:'92345',supplier_codigo:'hayamax',supplier_name:'Hayamax comercio',codigo:'73145',preco_custo:75.6,descricao:'Produto no fornecedor' };
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: {
  rpc:async () => ({data:supplier,error:null}),
  from:() => {
    let selected = '';
    const q: any = {
      select:(s:string) => { selected=s;return q; },eq:() => q,
      update:(p:any) => { updates.push(p); if(p.bling_product_id) localId=p.bling_product_id;return q; },
      maybeSingle:async () => ({data:selected==='bling_product_id' ? {bling_product_id:localId} : product,error:null}),
      then:(resolve:any) => resolve({error:null}),
    };
    return q;
  },
} }));
mock.module('../../src/lib/bling.server', () => ({
  blingApiGet:async () => ({ok:true,data:{data:[]},status:200,retries:0}),
  blingApiRequest:async (_i:any,method:string,path:string,body:any) => {
    calls.push({method,path,body}); return {ok:true,status:201,data:{data:{id:555}},retries:0};
  },
}));
mock.module('../../src/lib/bling-suppliers.server', () => ({
  supplierFromDetail:async () => confirmationFails ? {ok:false,status:503,row:null} : {
    ok:true,status:200,row:{id:777,produto:{id:555},fornecedor:{id:92345},codigo:'73145',precoCusto:75.6,padrao:true},
  },
  saveSupplierLinks:async () => { savedLinks++; },
}));
const { processItem } = await import('../../src/lib/bling-push.server');
const integration = {id:'integration',company_id:'destination',access_token:null,refresh_token:null,token_expires_at:null,status:'conectada'};
const item = {id:'queue',integration_id:'integration',company_id:'destination',product_id:'product',bling_product_id:'',bling_deposit_id:null,tipo:'criar' as const,valor_novo:0,tentativas:1,bling_product_store_id:null,payload:null};
beforeEach(() => { calls.length=0;updates.length=0;localId=null;confirmationFails=false;savedLinks=0; });
test('cria com fornecedor do destino e persiste vínculo confirmado', async () => {
  const result = await processItem(integration,item);
  expect(result.ok).toBe(true);
  expect(calls[0].path).toBe('/produtos');
  expect(calls[0].body.fornecedor.contato.id).toBe(92345);
  expect(calls[0].body.fornecedor.codigo).toBe('73145');
  expect(savedLinks).toBe(1);
  expect(updates.some(p => p.fornecedor_id==='92345' && p.preco_custo===75.6)).toBe(true);
});
test('falha na confirmação não conclui e repetição reutiliza ID criado', async () => {
  confirmationFails=true;
  expect((await processItem(integration,item)).ok).toBe(false);
  expect(localId).toBe('555');
  expect(savedLinks).toBe(0);
  confirmationFails=false;
  expect((await processItem(integration,item)).ok).toBe(true);
  expect(calls.filter(c => c.method==='POST' && c.path==='/produtos').length).toBe(1);
  expect(savedLinks).toBe(1);
});