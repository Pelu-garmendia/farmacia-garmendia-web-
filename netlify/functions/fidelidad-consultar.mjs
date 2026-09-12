// netlify/functions/fidelidad-consultar.mjs
//
// Consulta pública y de solo lectura de la Tarjeta Fidelidad por DNI.
// Usa la service role key del lado del servidor (nunca llega al navegador)
// y devuelve únicamente los campos que el cliente necesita ver de su propia
// tarjeta: nunca el teléfono ni datos de otros clientes.
//
// POST -> { dni } devuelve { found:false } o
//         { found:true, circulos, monto_acumulado, tarjetas_completadas }
//
// Configuración necesaria en Netlify (Site configuration → Environment variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

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
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Servidor sin configurar" }), { status: 500, headers: cors });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON inválido" }), { status: 400, headers: cors });
  }

  const dni = String(body.dni || "").trim();
  if (!/^\d{6,9}$/.test(dni)) {
    return new Response(JSON.stringify({ error: "DNI inválido" }), { status: 400, headers: cors });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await sb
    .from("fidelidad_clientes")
    .select("circulos, monto_acumulado, tarjetas_completadas")
    .eq("dni", dni)
    .maybeSingle();

  if (error) {
    return new Response(JSON.stringify({ error: "Error al consultar" }), { status: 500, headers: cors });
  }
  if (!data) {
    return new Response(JSON.stringify({ found: false }), { headers: cors });
  }

  return new Response(JSON.stringify({
    found: true,
    circulos: data.circulos,
    monto_acumulado: data.monto_acumulado,
    tarjetas_completadas: data.tarjetas_completadas,
  }), { headers: cors });
};
