-- Only products that had errors/warnings in their last audit count as "corrected";
-- automation edits (stock/price) on clean products must not enter corrected audits.
CREATE OR REPLACE FUNCTION public.track_audit_catalog_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.last_audit_at IS NOT NULL AND (coalesce(OLD.last_audit_errors,0) > 0 OR coalesce(OLD.last_audit_warnings,0) > 0) AND
    (to_jsonb(NEW) - ARRAY['updated_at','last_audit_at','last_audit_errors','last_audit_warnings','last_audit_passed','audit_correction_changed_at','dirty','bling_last_sent_payload','sincronizado_em','sincronizacao_status','sincronizacao_erro','ultimo_preco_sincronizado','ultimo_estoque_sincronizado','dados_resumidos_json','dados_completos_json','detail_synced','detail_synced_at','detail_sync_error','last_seen_sync_job_id','bling_updated_at'])
    IS DISTINCT FROM
    (to_jsonb(OLD) - ARRAY['updated_at','last_audit_at','last_audit_errors','last_audit_warnings','last_audit_passed','audit_correction_changed_at','dirty','bling_last_sent_payload','sincronizado_em','sincronizacao_status','sincronizacao_erro','ultimo_preco_sincronizado','ultimo_estoque_sincronizado','dados_resumidos_json','dados_completos_json','detail_synced','detail_synced_at','detail_sync_error','last_seen_sync_job_id','bling_updated_at'])
  THEN NEW.audit_correction_changed_at := clock_timestamp(); END IF;
  RETURN NEW;
END $$;
-- Drop pending marks from clean products and from the initial backfill guess.
UPDATE public.bling_products SET audit_correction_changed_at = NULL
WHERE audit_correction_changed_at IS NOT NULL
  AND (coalesce(last_audit_errors,0) = 0 AND coalesce(last_audit_warnings,0) = 0
       OR audit_correction_changed_at < '2026-10-29 00:30:00+00');
