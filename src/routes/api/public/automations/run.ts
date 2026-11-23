import { createFileRoute } from "@tanstack/react-router";

function trim(v: string | null | undefined) { return (v ?? "").trim(); }

export const Route = createFileRoute("/api/public/automations/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = trim(process.env.BLING_WORKER_SECRET);
        const provided = trim(request.headers.get("x-worker-secret"))
          || trim(new URL(request.url).searchParams.get("secret"));
        if (!secret || provided !== secret) return new Response("Forbidden", { status: 403 });

        const body = (await request.json().catch(() => ({}))) as { schedule_id?: string };
        const scheduleId = body.schedule_id;
        if (!scheduleId) return new Response("Missing schedule_id", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row } = await supabaseAdmin
          .from("automation_schedules")
          .select("id, company_id, slug, options")
          .eq("id", scheduleId)
          .maybeSingle();
        if (!row) return new Response("Schedule not found", { status: 404 });

        const s = row as { id: string; company_id: string; slug: string; options: Record<string, boolean> | null };
        const { runScheduledAutomation } = await import("@/lib/automations.server");
        const result = await runScheduledAutomation(s.company_id, s.slug, s.options ?? {}, s.id);
        return Response.json({ success: true, schedule_id: s.id, ...result });
      },
    },
  },
});
