import { createFileRoute } from "@tanstack/react-router";

function trim(v: string | null | undefined) { return (v ?? "").trim(); }

/**
 * Monta a fila de push em segundo plano (evita "upstream request timeout"
 * quando são dezenas de milhares de produtos).
 */
export const Route = createFileRoute("/api/public/bling/enqueue")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = trim(process.env.BLING_WORKER_SECRET);
        const provided = trim(request.headers.get("x-worker-secret"))
          || trim(new URL(request.url).searchParams.get("secret"));
        if (!secret || provided !== secret) return new Response("Forbidden", { status: 403 });

        const body = (await request.json().catch(() => ({}))) as {
          company_id?: string;
          product_ids?: string[] | null;
          scope?: string;
          include_stores?: boolean;
          only_changed?: boolean;
        };
        if (!body.company_id) return new Response("Missing company_id", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("enqueue_bling_push", {
          _company_id: body.company_id,
          _product_ids: (body.product_ids ?? null) as never,
          _scope: body.scope ?? "ambos",
          _include_stores: !!body.include_stores,
          _only_changed: body.only_changed !== false,
        } as never);
        if (error) return Response.json({ success: false, error: error.message }, { status: 500 });

        const base = (process.env.APP_PUBLIC_URL ?? new URL(request.url).origin).replace(/\/$/, "");

        // Dispara imediatamente o worker DESTA integração (não espera o cron),
        // e em seguida o fan-out para as demais empresas com fila pendente.
        const { data: integ } = await supabaseAdmin
          .from("bling_integrations")
          .select("id")
          .eq("company_id", body.company_id)
          .eq("status", "conectada")
          .maybeSingle();
        if (integ?.id) {
          await supabaseAdmin.rpc("enqueue_http_job", {
            _url: `${base}/api/public/bling/push-tick`,
            _secret: secret,
            _body: { integration_id: integ.id } as never,
          } as never);
        }

        await supabaseAdmin.rpc("enqueue_http_job", {
          _url: `${base}/api/public/bling/push-dispatch`,
          _secret: secret,
          _body: {} as never,
        } as never);

        return Response.json({ success: true, result: data });
      },
    },
  },
});
