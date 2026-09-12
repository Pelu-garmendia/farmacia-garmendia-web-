// netlify/functions/fidelidad-admin.mjs
//
// Todas las acciones de empleado de la Tarjeta Fidelidad (cargar compra,
// administrar la lista de premios) pasan por acá. Verifica la
// contraseña del equipo del lado del servidor en cada llamada y usa la
// service role key de Supabase (nunca expuesta al navegador) para leer y
// escribir. El navegador nunca toca las tablas directamente.
//
// POST -> { password, action, ...payload }
//   action: "login" | "cargarCompra" | "listarProductos" |
//           "agregarProducto" | "desactivarProducto"
//
// El canje del premio lo elige el cliente desde su propio panel
// (ver netlify/functions/fidelidad-canjear.mjs), no el empleado.
//
// Configuración necesaria en Netlify (Site configuration → Environment variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD_TIENDA

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD_TIENDA || "";

const MONTO_POR_CIRCULO = 17000;
const CIRCULOS_TOTAL = 10;

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

  if (!ADMIN_PASSWORD || body.password !== ADMIN_PASSWORD) {
    return new Response(JSON.stringify({ error: "Contraseña incorrecta" }), { status: 401, headers: cors });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const action = body.action;

  try {
    if (action === "login") {
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    if (action === "listarProductos") {
      const { data, error } = await sb
        .from("fidelidad_premios")
        .select("*")
        .eq("activo", true)
        .order("vencimiento", { ascending: true, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return new Response(JSON.stringify({ data }), { headers: cors });
    }

    if (action === "agregarProducto") {
      const nombre = String(body.nombre || "").trim();
      const vencimiento = String(body.vencimiento || "").trim();
      if (!nombre || !vencimiento) {
        return new Response(JSON.stringify({ error: "Completá el nombre y la fecha de vencimiento" }), { status: 400, headers: cors });
      }
      const { error } = await sb.from("fidelidad_premios").insert({ nombre, vencimiento });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    if (action === "desactivarProducto") {
      const { error } = await sb.from("fidelidad_premios").update({ activo: false }).eq("id", body.id);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    if (action === "cargarCompra") {
      const dni = String(body.dni || "").trim();
      const telRaw = String(body.telefono || "").trim();
      const monto = Number(body.monto);
      if (!dni || !monto || monto <= 0) {
        return new Response(JSON.stringify({ error: "Completá el DNI y un monto válido" }), { status: 400, headers: cors });
      }

      const { data: existente, error: errBuscar } = await sb
        .from("fidelidad_clientes").select("*").eq("dni", dni).maybeSingle();
      if (errBuscar) throw errBuscar;

      let circulos = existente ? existente.circulos : 0;
      let montoAcumulado = existente ? Number(existente.monto_acumulado) : 0;
      let tarjetasCompletadas = existente ? existente.tarjetas_completadas : 0;
      const telefono = telRaw || (existente ? existente.telefono : null);

      montoAcumulado += monto;
      const nuevosCirculos = Math.floor(montoAcumulado / MONTO_POR_CIRCULO);
      montoAcumulado -= nuevosCirculos * MONTO_POR_CIRCULO;
      circulos += nuevosCirculos;

      let tarjetaCompletadaAhora = false;
      while (circulos >= CIRCULOS_TOTAL) {
        circulos -= CIRCULOS_TOTAL;
        tarjetasCompletadas += 1;
        tarjetaCompletadaAhora = true;
      }

      const payload = {
        dni, telefono, circulos,
        monto_acumulado: montoAcumulado,
        tarjetas_completadas: tarjetasCompletadas,
        updated_at: new Date().toISOString(),
      };
      // Si se completa una tarjeta, queda un premio pendiente de elegir:
      // el cliente lo elige después desde su propio panel.
      if (tarjetaCompletadaAhora) payload.premio_pendiente = true;

      const { error: errGuardar } = existente
        ? await sb.from("fidelidad_clientes").update(payload).eq("dni", dni)
        : await sb.from("fidelidad_clientes").insert(payload);
      if (errGuardar) throw errGuardar;

      await sb.from("fidelidad_movimientos").insert({
        dni, monto, circulos_sumados: nuevosCirculos, tarjeta_completada: tarjetaCompletadaAhora,
      });

      return new Response(JSON.stringify({
        circulos, tarjetaCompletadaAhora, telefono,
      }), { headers: cors });
    }

    return new Response(JSON.stringify({ error: "Acción desconocida" }), { status: 400, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Error al procesar la solicitud" }), { status: 500, headers: cors });
  }
};
