// netlify/functions/fidelidad-canjear.mjs
//
// El cliente confirma, desde su propio panel ("Consultar mi tarjeta"),
// qué premio eligió una vez que completó la tarjeta. Es pública (no pide
// contraseña de empleado) porque es una acción del propio cliente sobre
// su propia tarjeta, pero solo funciona si esa tarjeta tiene un premio
// realmente pendiente.
//
// POST -> { telefono, producto } devuelve { ok:true } o un error.
//
// Configuración necesaria en Netlify (Site configuration → Environment variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function normalizarTelefono(tel) {
  let d = String(tel || "").replace(/\D/g, "");
  d = d.replace(/^0/, "").replace(/^15/, "");
  return d;
}

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

  const telefono = normalizarTelefono(body.telefono);
  const producto = String(body.producto || "").trim().slice(0, 200);
  if (!telefono || telefono.length < 8 || telefono.length > 11 || !producto) {
    return new Response(JSON.stringify({ error: "Datos inválidos" }), { status: 400, headers: cors });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: cliente, error: errBuscar } = await sb
    .from("fidelidad_clientes")
    .select("premio_pendiente")
    .eq("telefono", telefono)
    .maybeSingle();
  if (errBuscar) {
    return new Response(JSON.stringify({ error: "Error al buscar la tarjeta" }), { status: 500, headers: cors });
  }
  if (!cliente || !cliente.premio_pendiente) {
    return new Response(JSON.stringify({ error: "No hay ningún premio pendiente para canjear" }), { status: 400, headers: cors });
  }

  const { error: errGuardar } = await sb
    .from("fidelidad_clientes")
    .update({ ultimo_premio: producto, premio_pendiente: false })
    .eq("telefono", telefono);
  if (errGuardar) {
    return new Response(JSON.stringify({ error: "Error al registrar el canje" }), { status: 500, headers: cors });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: cors });
};
