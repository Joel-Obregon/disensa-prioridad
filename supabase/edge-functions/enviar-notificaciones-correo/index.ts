// ============================================================================
// Edge Function: enviar-notificaciones-correo
// Vacia la cola public.notificaciones_correo enviando los correos pendientes.
// ----------------------------------------------------------------------------
// QUE HACE:
//   1. Lee las filas con estado = 'pendiente' (limite configurable).
//   2. Envia cada una con Resend (https://resend.com).
//   3. Marca estado = 'enviado' y enviado_at = now() si el envio fue OK,
//      o estado = 'error' si fallo.
//
// CONFIGURAR ANTES DE DESPLEGAR (Supabase > Edge Functions > Secrets):
//   SUPABASE_URL                -> URL del proyecto (la pone Supabase sola)
//   SUPABASE_SERVICE_ROLE_KEY   -> service role key (NO la anon; la pone Supabase)
//   RESEND_API_KEY              -> tu clave de Resend
//   CORREO_REMITENTE            -> remitente verificado en Resend, ej: alertas@tudominio.com
//
// DESPLIEGUE:
//   supabase functions deploy enviar-notificaciones-correo
// PROGRAMAR cada 10 min (Supabase > Database > Cron, o pg_cron):
//   select cron.schedule('enviar-correos','*/10 * * * *',
//     $$ select net.http_post(
//          url := 'https://<REF>.supabase.co/functions/v1/enviar-notificaciones-correo',
//          headers := jsonb_build_object('Authorization','Bearer <ANON_O_SERVICE_KEY>')
//        ) $$);
//
// OJO: hay 153 correos viejos en cola. Si NO quieres enviarlos, primero
// ejecuta 21_correos_pendientes.sql (opcion de descarte) y deja esta funcion
// solo para los correos nuevos.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LIMITE = 50; // correos por ejecucion

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const remitente = Deno.env.get("CORREO_REMITENTE");

  if (!resendKey || !remitente) {
    return json({ ok: false, error: "Faltan RESEND_API_KEY o CORREO_REMITENTE" }, 500);
  }

  const { data: pendientes, error } = await supabase
    .from("notificaciones_correo")
    .select("id, destinatario, asunto, mensaje, departamento")
    .eq("estado", "pendiente")
    .order("created_at", { ascending: true })
    .limit(LIMITE);

  if (error) return json({ ok: false, error: error.message }, 500);
  if (!pendientes || pendientes.length === 0) return json({ ok: true, enviados: 0 });

  let enviados = 0, fallidos = 0;

  for (const n of pendientes) {
    const destino = n.destinatario || departamentoACorreo(n.departamento);
    if (!destino) {
      await marcar(supabase, n.id, "error");
      fallidos++;
      continue;
    }

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: remitente,
        to: [destino],
        subject: n.asunto || "Alerta de inventario - Disensa",
        html: `<p>${(n.mensaje || "").replace(/</g, "&lt;")}</p>`,
      }),
    });

    if (r.ok) {
      await marcar(supabase, n.id, "enviado");
      enviados++;
    } else {
      await marcar(supabase, n.id, "error");
      fallidos++;
    }
  }

  return json({ ok: true, enviados, fallidos });
});

async function marcar(supabase: ReturnType<typeof createClient>, id: string, estado: string) {
  const patch: Record<string, unknown> = { estado };
  if (estado === "enviado") patch.enviado_at = new Date().toISOString();
  await supabase.from("notificaciones_correo").update(patch).eq("id", id);
}

// Ajusta este mapeo a los correos reales de cada departamento.
function departamentoACorreo(departamento?: string | null): string | null {
  const mapa: Record<string, string> = {
    "Departamento de inventario": "inventario@tudominio.com",
    "Bodega": "bodega@tudominio.com",
  };
  return departamento ? (mapa[departamento] ?? null) : null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
