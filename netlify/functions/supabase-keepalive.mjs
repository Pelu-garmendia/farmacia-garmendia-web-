// netlify/functions/supabase-keepalive.mjs
//
// Función programada: hace una consulta mínima a Supabase una vez por día
// para que el proyecto (plan gratuito) no se pause por inactividad. Si se
// pausa, la consulta de la tarjeta Club Farmendia falla con "Ocurrió un
// error al consultar".
//
// Netlify la ejecuta sola según `config.schedule`; solo corre en el deploy
// publicado (producción), no en deploy previews ni ramas.
//
// Configuración necesaria en Netlify (Site configuration → Environment variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

export default async () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("keepalive: faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    return new Response("Servidor sin configurar", { status: 500 });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { count, error } = await sb
    .from("fidelidad_clientes")
    .select("telefono", { count: "exact", head: true });

  if (error) {
    console.error("keepalive: error al consultar Supabase", error.message);
    return new Response("Error", { status: 500 });
  }

  console.log(`keepalive: ok (${count} clientes)`);
  return new Response("ok");
};

export const config = {
  schedule: "@daily",
};
