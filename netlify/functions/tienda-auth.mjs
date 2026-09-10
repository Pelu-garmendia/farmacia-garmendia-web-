// netlify/functions/tienda-auth.mjs
//
// Verifica la contraseña del panel admin de la tienda del lado del servidor,
// para que la clave nunca viaje en el HTML/JS público del sitio.
//
// POST -> { password } devuelve { ok: true } o 401 { ok: false }
//
// Configuración necesaria en Netlify:
//   Variable de entorno ADMIN_PASSWORD_TIENDA en
//   Site configuration → Environment variables

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD_TIENDA || "";

export default async (req) => {
  const cors = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: cors });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "JSON inválido" }), { status: 400, headers: cors });
  }

  if (!ADMIN_PASSWORD || body.password !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ ok: false, error: "Contraseña incorrecta" }), { status: 401, headers: cors });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: cors });
};
