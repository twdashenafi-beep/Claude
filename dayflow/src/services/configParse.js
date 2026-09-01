// Making sense of what gets pasted into the sync setup screen.
//
// Pure: no storage, no React Native, no build-time environment. Everything here
// exists because these two values are copied out of a browser by hand, and the
// ways that goes wrong are predictable — the dashboard URL instead of the
// project URL, a REST path left on the end, the two fields swapped, a stray
// newline from a triple-click, or, the one that actually matters, the
// service_role key instead of the anon key.

const DASHBOARD = /supabase\.com\/dashboard\/project\/([a-z0-9]{16,32})/i;
const BARE_REF = /^[a-z]{20}$/;
const API_PATHS = /\/(rest|auth|storage|realtime|graphql|functions)\/v1\/?$/i;

function strip(value) {
  return String(value == null ? '' : value).trim().replace(/^["'<]+|["'>]+$/g, '').trim();
}

export function normalizeUrl(raw) {
  let v = strip(raw);
  if (!v) return '';

  // Someone copied the address bar of the Supabase dashboard rather than the
  // Project URL. The reference in that path is all we need to build the real one.
  const dash = v.match(DASHBOARD);
  if (dash) return `https://${dash[1].toLowerCase()}.supabase.co`;

  // Just the project reference, pasted from the "Reference ID" field.
  if (BARE_REF.test(v)) return `https://${v}.supabase.co`;

  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  v = v.replace(/\s+/g, '');
  v = v.replace(API_PATHS, '');
  v = v.replace(/\/+$/, '');
  return v;
}

export function normalizeKey(raw) {
  // No form of Supabase key contains whitespace, so anything wrapped by a
  // copy-paste can go without risk of corrupting a real value.
  return strip(raw).replace(/\s+/g, '');
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Hermes has no atob, and pulling in a base64 library to read one JWT claim is
// not worth it.
function decodeBase64Url(input) {
  const s = String(input).replace(/-/g, '+').replace(/_/g, '/');
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '=') break;
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

// Returns the JWT's role claim, or null if this is not a readable JWT.
export function keyRole(key) {
  const parts = String(key || '').split('.');
  if (parts.length !== 3) return null;
  const payload = decodeBase64Url(parts[1]);
  if (!payload) return null;
  try {
    const claims = JSON.parse(payload);
    return typeof claims.role === 'string' ? claims.role : null;
  } catch {
    return null;
  }
}

function looksLikeKey(v) {
  // A project URL also splits into three dot-separated parts, so the JWT shape
  // test on its own would call every URL a key.
  if (looksLikeUrl(v)) return false;
  return /^sb_(publishable|secret)_/.test(v) || String(v).split('.').length === 3;
}

function looksLikeUrl(v) {
  return /^https?:\/\//i.test(v) || /supabase\.(co|com)/i.test(v) || BARE_REF.test(v);
}

// Checks shape only — nothing here touches the network.
//
// `fixes` are corrections already applied to what was typed, worth showing back
// so the result is not silently different from what was pasted.
export function parseConfig(rawUrl, rawKey) {
  const fixes = [];
  let u = strip(rawUrl);
  let k = strip(rawKey);

  if (!u && !k) return { ok: false, error: 'Enter your project URL and anon key.', fixes };

  // The fields are adjacent and look alike at a glance.
  if (u && k && looksLikeKey(u) && looksLikeUrl(k)) {
    [u, k] = [k, u];
    fixes.push('Swapped the two values — they were the wrong way round.');
  }

  if (!u) return { ok: false, error: 'Enter your project URL.', fixes };
  if (!k) return { ok: false, error: 'Enter your anon public key.', fixes };

  const url = normalizeUrl(u);
  const anonKey = normalizeKey(k);

  if (DASHBOARD.test(u)) fixes.push('Used the project URL from that dashboard link.');
  else if (BARE_REF.test(u)) fixes.push('Built the project URL from that reference ID.');
  else if (url !== u) fixes.push('Tidied the URL.');

  if (!/^https:\/\/[^/\s]+\.[^/\s]+$/i.test(url) && !/^https?:\/\/localhost(:\d+)?$/i.test(url)) {
    return { ok: false, error: 'That does not look like a project URL. It should read like https://abcdefghijklmnop.supabase.co', fixes };
  }

  // The one genuine security check. A service_role key bypasses Row Level
  // Security entirely, so a copy of it in a browser hands every account's rows
  // to anyone who opens the developer console.
  if (/^sb_secret_/.test(anonKey) || keyRole(anonKey) === 'service_role') {
    return {
      ok: false,
      fixes,
      error: 'That is the service_role key — it bypasses all database security and must never go in an app. Use the key labelled "anon" / "public" instead.',
    };
  }

  const role = keyRole(anonKey);
  const isPublishable = /^sb_publishable_/.test(anonKey);
  if (!isPublishable && role !== 'anon') {
    if (role) {
      return { ok: false, fixes, error: `That key is for the "${role}" role. Use the key labelled "anon" / "public".` };
    }
    return { ok: false, fixes, error: 'That does not look like a Supabase key. It starts with "eyJ" or "sb_publishable_".' };
  }

  if (anonKey !== k) fixes.push('Removed stray spaces from the key.');

  return { ok: true, config: { url, anonKey }, fixes };
}

// Asks the project whether the pair actually works, so a wrong value is caught
// here rather than as a failed sign-in later.
// What the server said, when it says anything useful. Guessing from a status
// code alone has already cost more time than reading the body would have.
async function serverMessage(response) {
  try {
    const text = await response.text();
    if (!text) return '';
    try {
      const body = JSON.parse(text);
      return String(body.message || body.msg || body.error_description || body.error || '').trim();
    } catch {
      return text.slice(0, 160).trim();
    }
  } catch {
    return '';
  }
}

export async function verifyConfig({ url, anonKey }, { timeoutMs = 12000 } = {}) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller && controller.abort(), timeoutMs);

  let response;
  try {
    // Only the apikey header. A publishable key is not a JWT, so also sending
    // it as a bearer token gives the gateway something it cannot parse and a
    // perfectly good key comes back rejected.
    response = await fetch(`${url}/rest/v1/`, {
      method: 'GET',
      headers: { apikey: anonKey },
      signal: controller ? controller.signal : undefined,
    });
  } catch {
    return { ok: false, error: `Could not reach ${url}. Check the URL, and that you are online.` };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    // Whatever the project said is worth more than anything guessed from the
    // status code, so lead with it.
    const said = await serverMessage(response);
    // Projects on the newer key system usually have the legacy JWT keys turned
    // off, so a correctly copied "anon" key is refused with no hint as to why.
    const legacy = String(anonKey).split('.').length === 3;
    const hint = legacy
      ? ' That is a legacy "anon" key; projects on the newer key system have those switched off. Try the publishable key instead — Project Settings → API Keys, starting "sb_publishable_".'
      : ' Copy it again from Project Settings → API Keys.';
    return {
      ok: false,
      error: `The project rejected that key${said ? ` — it said: "${said}".` : '.'}${hint}`,
    };
  }
  if (!response.ok && response.status >= 500) {
    return { ok: false, error: `The project answered with an error (${response.status}). Try again in a moment.` };
  }
  if (!response.ok && response.status === 404) {
    return { ok: false, error: 'That host is reachable but is not a Supabase project. Check the URL.' };
  }
  return { ok: true };
}
