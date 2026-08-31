// netlify/functions/turnos-estado.mjs
//
// Guarda y expone el estado de "farmacias con inconvenientes hoy" usando
// Netlify Blobs (almacenamiento compartido, sin base de datos externa).
//
// GET  -> devuelve { "Nombre Farmacia": { inconveniente, motivo, updatedAt }, ... }
// POST -> { password, updates: [{ nombre, inconveniente, motivo }, ...] }
//         requiere la contraseña correcta (variable de entorno ADMIN_PASSWORD_FARMACLICK)
//
// Configuración necesaria en Netlify:
//   1) netlify.toml debe apuntar functions = "netlify/functions"
//   2) package.json en la raíz del repo con la dependencia "@netlify/blobs"
//   3) Variable de entorno ADMIN_PASSWORD_FARMACLICK en
//      Site configuration → Environment variables

import { getStore } from "@netlify/blobs";

const STORE_NAME = "turnos-estado";
const KEY = "estados";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD_FARMACLICK || "";

export default async (req) => {
  const store = getStore(STORE_NAME);

  const cors = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method === "GET") {
    const data = (await store.get(KEY, { type: "json" })) || {};
    return new Response(JSON.stringify(data), { headers: cors });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "JSON inválido" }), { status: 400, headers: cors });
    }

    if (!ADMIN_PASSWORD || body.password !== ADMIN_PASSWORD) {
      return new Response(JSON.stringify({ error: "Contraseña incorrecta" }), { status: 401, headers: cors });
    }

    const updates = Array.isArray(body.updates) ? body.updates : [];
    const data = (await store.get(KEY, { type: "json" })) || {};

    for (const u of updates) {
      if (!u || !u.nombre) continue;
      if (u.inconveniente) {
        data[u.nombre] = {
          inconveniente: true,
          motivo: (u.motivo || "").slice(0, 200),
          updatedAt: new Date().toISOString(),
        };
      } else {
        delete data[u.nombre];
      }
    }

    await store.setJSON(KEY, data);

    return new Response(JSON.stringify({ ok: true, estados: data }), { headers: cors });
  }

  return new Response("Method Not Allowed", { status: 405, headers: cors });
};
