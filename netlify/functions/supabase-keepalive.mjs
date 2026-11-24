// netlify/functions/supabase-keepalive.mjs
//
// Función programada: hace una lectura mínima a Supabase una vez por día
// para que el proyecto (plan gratuito) no se pause por inactividad. Si se
// pausa, FarmaClick deja de mostrar los avisos de turnos y /admin no carga.
//
// Usa solo la clave pública (anon): no necesita variables de entorno.
// Netlify la ejecuta sola según `config.schedule`; solo corre en producción.

const SUPABASE_URL = "https://qlzwatloykyugyptxbvb.supabase.co";
const ANON_KEY = "sb_publishable_KMW3N1ZQtAbVEwxuBA-Jgw_YrPBkL4m";

export default async () => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/turnos_avisos?select=farmacia&limit=1`, {
    headers: { apikey: ANON_KEY },
  });
  if (!res.ok) {
    console.error("keepalive: error al consultar Supabase", res.status);
    return new Response("Error", { status: 500 });
  }
  console.log("keepalive: ok");
  return new Response("ok");
};

export const config = {
  schedule: "@daily",
};
