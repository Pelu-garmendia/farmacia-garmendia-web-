// netlify/functions/fidelidad-admin.mjs
//
// Todas las acciones de empleado del Club Farmendia (cargar compra,
// administrar la lista de premios) pasan por acá. Verifica la
// contraseña del equipo del lado del servidor en cada llamada y usa la
// service role key de Supabase (nunca expuesta al navegador) para leer,
// escribir y subir fotos de premios. El navegador nunca toca las tablas
// ni el storage directamente.
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

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD_TIENDA || "";

const MONTO_POR_CIRCULO = 17000;
const CIRCULOS_TOTAL = 10;
const IMAGEN_MAX_BYTES = 3 * 1024 * 1024;

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
      const vencimiento = String(body.vencimiento || "").trim() || null;
      if (!nombre) {
        return new Response(JSON.stringify({ error: "Completá el nombre del premio" }), { status: 400, headers: cors });
      }

      let imagen_url = null;
      if (body.imagenBase64) {
        const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(body.imagenBase64);
        if (!match) {
          return new Response(JSON.stringify({ error: "Formato de imagen no soportado" }), { status: 400, headers: cors });
        }
        const [, mime, b64] = match;
        const buffer = Buffer.from(b64, "base64");
        if (buffer.length > IMAGEN_MAX_BYTES) {
          return new Response(JSON.stringify({ error: "La imagen es demasiado pesada" }), { status: 400, headers: cors });
        }
        const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
        const path = `${randomUUID()}.${ext}`;
        const { error: errSubir } = await sb.storage.from("premios").upload(path, buffer, { contentType: mime });
        if (errSubir) throw errSubir;
        imagen_url = sb.storage.from("premios").getPublicUrl(path).data.publicUrl;
      }

      const { error } = await sb.from("fidelidad_premios").insert({ nombre, vencimiento, imagen_url });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    if (action === "desactivarProducto") {
      const { error } = await sb.from("fidelidad_premios").update({ activo: false }).eq("id", body.id);
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    if (action === "cargarCompra") {
      const telefono = normalizarTelefono(body.telefono);
      const monto = Number(body.monto);
      if (!telefono || telefono.length < 8 || telefono.length > 11 || !monto || monto <= 0) {
        return new Response(JSON.stringify({ error: "Completá el celular y un monto válido" }), { status: 400, headers: cors });
      }

      const { data: existente, error: errBuscar } = await sb
        .from("fidelidad_clientes").select("*").eq("telefono", telefono).maybeSingle();
      if (errBuscar) throw errBuscar;

      let circulos = existente ? existente.circulos : 0;
      let montoAcumulado = existente ? Number(existente.monto_acumulado) : 0;
      let tarjetasCompletadas = existente ? existente.tarjetas_completadas : 0;

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
        telefono, circulos,
        monto_acumulado: montoAcumulado,
        tarjetas_completadas: tarjetasCompletadas,
        updated_at: new Date().toISOString(),
      };
      // Si se completa una tarjeta, queda un premio pendiente de elegir:
      // el cliente lo elige después desde su propio panel.
      if (tarjetaCompletadaAhora) payload.premio_pendiente = true;

      const { error: errGuardar } = existente
        ? await sb.from("fidelidad_clientes").update(payload).eq("telefono", telefono)
        : await sb.from("fidelidad_clientes").insert(payload);
      if (errGuardar) throw errGuardar;

      await sb.from("fidelidad_movimientos").insert({
        telefono, monto, circulos_sumados: nuevosCirculos, tarjeta_completada: tarjetaCompletadaAhora,
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
