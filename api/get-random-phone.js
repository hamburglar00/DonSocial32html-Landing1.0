// /api/get-random-phone.js
// ✅ Elige base URL por % (weighted routing)
// ✅ Elige agency_id por % (weighted routing)
// ✅ Devuelve 1 número listo para usar en wa.me
// ✅ Plan A/B/C/D (retries + cache last good + fallback soporte)

const CONFIG = {
  // true  => SOLO ADS
  // false => ADS primero, si no hay ADS usa NORMAL
  ONLY_ADS_WHATSAPP: true,

  SUPPORT_FALLBACK_ENABLED: false,
  SUPPORT_FALLBACK_NUMBER: "",

  TIMEOUT_MS: 2500,
  MAX_RETRIES: 2,

  /**************************************************************
   * ✅ ROUTING POR %
   **************************************************************/
  UPSTREAMS: [
    {
      key: "ases",
      base: "https://api.asesadmin.com/api/v1",
      weight: 70,
      agencies: [
        { id: 28, name: "Ceti", weight: 100 },
        // { id: 17, name: "Geraldina", weight: 50 },
      ],
    },
    {
      key: "foxy",
      base: "https://api.foxyadminbot.info/api/v1",
      weight: 30,
      agencies: [
        { id: 28, name: "Ceti", weight: 100 },
      ],
    },
  ],
};

let LAST_GOOD_NUMBER = null;
let LAST_GOOD_META = null;

/**************************************************************
 * Utils
 **************************************************************/
function normalizePhone(raw) {
  let phone = String(raw || "").replace(/\D+/g, "");
  if (phone.length === 10) phone = "54" + phone;
  if (!phone || phone.length < 8) return null;
  return phone;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeighted(items) {
  const clean = (Array.isArray(items) ? items : [])
    .map((x) => ({ ...x, weight: Number(x?.weight ?? 0) }))
    .filter((x) => x.weight > 0);

  if (!clean.length) return null;

  const total = clean.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;

  for (const it of clean) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return clean[clean.length - 1] || null;
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "Cache-Control": "no-store" },
      signal: ctrl.signal,
    });
    const ms = Date.now() - started;

    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.http_status = res.status;
      err.ms = ms;
      throw err;
    }

    const json = await res.json();
    return { json, ms, status: res.status };
  } finally {
    clearTimeout(t);
  }
}

/**************************************************************
 * Handler
 **************************************************************/
export default async function handler(req, res) {
  const startedAt = Date.now();
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");

  const mode = String(req.query.mode || "normal").toLowerCase();

  const forcedUpstreamKey = String(req.query.upstream || "").toLowerCase().trim();
  const forcedAgencyId = String(req.query.agency_id || "").trim();

  try {
    /**************************************************************
     * 1) Elegir upstream por %
     **************************************************************/
    let upstream = null;

    if (forcedUpstreamKey) {
      upstream = CONFIG.UPSTREAMS.find(
        (u) => String(u.key).toLowerCase() === forcedUpstreamKey
      );
      if (!upstream) throw new Error(`upstream inválido: ${forcedUpstreamKey}`);
    } else {
      upstream = pickWeighted(CONFIG.UPSTREAMS);
      if (!upstream?.base) throw new Error("No hay UPSTREAMS configurados");
    }

    /**************************************************************
     * 2) Elegir agency por %
     **************************************************************/
    let agency = null;

    if (forcedAgencyId) {
      const idNum = Number(forcedAgencyId);
      if (!Number.isFinite(idNum)) throw new Error(`agency_id inválido`);
      agency =
        upstream.agencies.find((a) => a.id === idNum) ||
        { id: idNum, name: `agency_${idNum}` };
    } else {
      agency = pickWeighted(upstream.agencies);
      if (!agency?.id) throw new Error("No hay agencies configuradas");
    }

    /**************************************************************
     * 3) Construir URL final
     **************************************************************/
    const API_URL = `${upstream.base}/agency/${agency.id}/random-contact`;

    /**************************************************************
     * 4) Upstream con retries
     **************************************************************/
    let data = null;
    const upstreamMeta = {
      upstream_key: upstream.key,
      upstream_base: upstream.base,
      attempts: 0,
      last_error: null,
      ms: null,
      status: null,
      api_url: API_URL,
    };

    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES && !data; attempt++) {
      upstreamMeta.attempts = attempt;
      try {
        const r = await fetchJsonWithTimeout(API_URL, CONFIG.TIMEOUT_MS);
        data = r.json;
        upstreamMeta.ms = r.ms;
        upstreamMeta.status = r.status;
      } catch (e) {
        upstreamMeta.last_error = e?.message || "unknown";
        upstreamMeta.status = e?.http_status || null;
      }
    }

    if (!data) {
      throw new Error(`Upstream fail: ${upstreamMeta.last_error}`);
    }

    /**************************************************************
     * 5) Elegir número ADS / NORMAL
     **************************************************************/
    const adsList = Array.isArray(data?.ads?.whatsapp) ? data.ads.whatsapp : [];
    const normalList = Array.isArray(data?.whatsapp) ? data.whatsapp : [];

    let rawPhone = null;
    let chosenSource = null;

    if (CONFIG.ONLY_ADS_WHATSAPP) {
      if (!adsList.length) throw new Error("ONLY_ADS activo y ads vacío");
      rawPhone = pickRandom(adsList);
      chosenSource = "ads.whatsapp";
    } else {
      if (adsList.length) {
        rawPhone = pickRandom(adsList);
        chosenSource = "ads.whatsapp";
      } else if (normalList.length) {
        rawPhone = pickRandom(normalList);
        chosenSource = "whatsapp";
      } else {
        throw new Error("Sin números disponibles");
      }
    }

    const phone = normalizePhone(rawPhone);
    if (!phone) throw new Error("Número inválido");

    /**************************************************************
     * 6) Cache último bueno
     **************************************************************/
    LAST_GOOD_NUMBER = phone;
    LAST_GOOD_META = {
      upstream_key: upstream.key,
      upstream_base: upstream.base,
      agency_id: agency.id,
      agency_name: agency.name || "",
      source: chosenSource,
      only_ads: CONFIG.ONLY_ADS_WHATSAPP,
      ts: new Date().toISOString(),
      upstream: upstreamMeta,
      ads_len: adsList.length,
      normal_len: normalList.length,
    };

    return res.status(200).json({
      number: phone,
      mode,

      upstream_key: upstream.key,
      upstream_base: upstream.base,

      agency_id: agency.id,
      agency_name: agency.name || "",

      chosen_from: chosenSource,
      only_ads: CONFIG.ONLY_ADS_WHATSAPP,

      ms: Date.now() - startedAt,
      upstream: upstreamMeta,
    });
  } catch (err) {
    if (LAST_GOOD_NUMBER) {
      return res.status(200).json({
        number: LAST_GOOD_NUMBER,
        cache: true,
        last_good_meta: LAST_GOOD_META,
        error: err?.message,
        ms: Date.now() - startedAt,
      });
    }

    if (CONFIG.SUPPORT_FALLBACK_ENABLED) {
      return res.status(200).json({
        number: CONFIG.SUPPORT_FALLBACK_NUMBER,
        fallback: true,
        error: err?.message,
        ms: Date.now() - startedAt,
      });
    }

    return res.status(503).json({
      error: "NO_NUMBER_AVAILABLE",
      details: err?.message,
      ms: Date.now() - startedAt,
    });
  }
}
