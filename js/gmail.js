// Envoi des mails par l'API Gmail, depuis le compte Gmail dédié (gratuit).
// L'autorisation se fait via Google Identity Services : une fenêtre Google s'ouvre, on se connecte, c'est tout.

const SCOPE = 'https://www.googleapis.com/auth/gmail.send';
let gisLoaded = null;
let token = null;
let tokenExpiry = 0;
let tokenClient = null;
let tokenClientId = null;
let pending = null;

export function loadGis() {
  if (gisLoaded) return gisLoaded;
  gisLoaded = new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisLoaded = null;
      reject(new Error('Impossible de charger le service de connexion Google (connexion internet ?).'));
    };
    document.head.appendChild(s);
  });
  return gisLoaded;
}

export const hasValidToken = () => token && Date.now() < tokenExpiry - 60000;

// À appeler directement dans un clic (sinon la fenêtre Google est bloquée).
export function authorize(clientId) {
  if (hasValidToken()) return Promise.resolve(token);
  if (!window.google || !window.google.accounts) return Promise.reject(new Error('Service Google pas encore chargé, réessayez dans une seconde.'));
  if (!tokenClient || tokenClientId !== clientId) {
    tokenClientId = clientId;
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: resp => {
        const p = pending;
        pending = null;
        if (!p) return;
        if (resp.error) return p.reject(new Error('Autorisation Google refusée : ' + resp.error));
        token = resp.access_token;
        tokenExpiry = Date.now() + (resp.expires_in || 3600) * 1000;
        p.resolve(token);
      },
      error_callback: err => {
        const p = pending;
        pending = null;
        p && p.reject(new Error(err && err.type === 'popup_closed' ? 'Fenêtre Google fermée.' : 'Connexion Google impossible (' + ((err && err.type) || 'erreur') + ').'));
      },
    });
  }
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

// ---------- Construction du mail (MIME) ----------
const b64 = str => btoa(unescape(encodeURIComponent(str)));
const encWord = s => `=?UTF-8?B?${b64(s)}?=`;
const wrap76 = s => s.replace(/.{1,76}/g, '$&\r\n');

function bytesToB64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function buildMime({ to, bcc, subject, body, attachment, attachments }) {
  const boundary = 'part_' + Math.random().toString(36).slice(2);
  const files = attachments || (attachment ? [attachment] : []);
  const lines = [
    ...(to ? [`To: ${to}`] : []),
    ...(bcc ? [`Bcc: ${bcc}`] : []),
    `Subject: ${encWord(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(b64(body)),
  ];
  for (const f of files) {
    lines.push(
      `--${boundary}`,
      `Content-Type: ${f.type || 'application/pdf'}; name="${encWord(f.name)}"`,
      `Content-Disposition: attachment; filename="${encWord(f.name)}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(bytesToB64(f.bytes))
    );
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

export async function sendMail(clientId, msg) {
  const tk = await authorize(clientId);
  // Adresse « simple » de l'API (message encodé en base64url dans du JSON) : contrairement à
  // l'adresse /upload, elle renvoie les en-têtes CORS, sinon le navigateur croit à une erreur réseau.
  const raw = bytesToB64(new TextEncoder().encode(buildMime(msg))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (res.status === 401) {
    token = null;
    throw new Error('Session Google expirée, relancez l’envoi.');
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).error.message;
    } catch {}
    throw new Error(`Gmail a refusé l'envoi (${res.status}) ${detail}`);
  }
  return res.json();
}

export function fillTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] ?? '' : m));
}
