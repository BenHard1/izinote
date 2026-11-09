// Code du relais Google Apps Script, à coller dans script.google.com (compte Gmail dédié).
// Le code secret est inséré par l'appli.
export const relayScript = secret => `// IziNote – relais d'envoi programmé.
// Garde les mails programmés dans Google Drive (dossier « IziNote – envois programmés »)
// et les envoie depuis ce compte Gmail à l'heure prévue, même si la tablette est éteinte.
const SECRET = '${secret}';
const DOSSIER = 'IziNote – envois programmés';
const VERSION = 2; // 2 : copie cachée et plusieurs pièces jointes (devoirs et rappels)

// 1) Exécutez cette fonction une fois (bouton ▶ Exécuter) et acceptez les autorisations.
function installer() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('envoyerProgrammes').timeBased().everyMinutes(5).create();
  dossier_();
  Logger.log('Relais installé ✓ (vérification toutes les 5 minutes)');
}

// 2) Déployez ensuite en « Application Web » (Exécuter en tant que : moi ; Accès : tout le monde).
function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.secret !== SECRET) return json_({ ok: false, error: 'code secret incorrect' });
    const racine = dossier_();
    if (d.action === 'ping') return json_({ ok: true, version: VERSION, quota: MailApp.getRemainingDailyQuota() });
    if (d.action === 'schedule') {
      const m = d.mail;
      supprimer_(racine, m.id + '.json');
      supprimer_(sous_('erreurs'), m.id + '.txt');
      racine.createFile(m.id + '.json', JSON.stringify(m), 'application/json');
      return json_({ ok: true });
    }
    if (d.action === 'cancel') {
      (d.ids || []).forEach(id => supprimer_(racine, id + '.json'));
      return json_({ ok: true });
    }
    if (d.action === 'status') return json_({ ok: true, sent: lire_(sous_('envoyes')), errors: lire_(sous_('erreurs')) });
    if (d.action === 'ack') {
      (d.ids || []).forEach(id => supprimer_(sous_('envoyes'), id + '.txt'));
      return json_({ ok: true });
    }
    return json_({ ok: false, error: 'action inconnue' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function envoyerProgrammes() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const racine = dossier_();
    const it = racine.getFilesByType('application/json');
    const now = Date.now();
    while (it.hasNext()) {
      const f = it.next();
      let m;
      try { m = JSON.parse(f.getBlob().getDataAsString()); } catch (err) { f.setTrashed(true); continue; }
      if (m.sendAt > now) continue;
      try {
        const opts = {};
        if (m.fromName) opts.name = m.fromName;
        if (m.bcc) opts.bcc = m.bcc;
        const pj = [];
        if (m.pdf) pj.push(Utilities.newBlob(Utilities.base64Decode(m.pdf), 'application/pdf', m.fileName || 'correction.pdf'));
        (m.attachments || []).forEach(a => pj.push(Utilities.newBlob(Utilities.base64Decode(a.b64), a.type || 'application/octet-stream', a.name)));
        if (pj.length) opts.attachments = pj;
        // envoi groupé en copie cachée : le mail est adressé au compte lui-même
        GmailApp.sendEmail(m.to || Session.getEffectiveUser().getEmail(), m.subject, m.body, opts);
        sous_('envoyes').createFile(m.id + '.txt', String(Date.now()));
        f.setTrashed(true);
      } catch (err) {
        m.essais = (m.essais || 0) + 1;
        if (m.essais >= 3) {
          sous_('erreurs').createFile(m.id + '.txt', String(err));
          f.setTrashed(true);
        } else {
          f.setContent(JSON.stringify(m));
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function dossier_() {
  const it = DriveApp.getFoldersByName(DOSSIER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DOSSIER);
}
function sous_(nom) {
  const r = dossier_();
  const it = r.getFoldersByName(nom);
  return it.hasNext() ? it.next() : r.createFolder(nom);
}
function supprimer_(dossier, nom) {
  const it = dossier.getFilesByName(nom);
  while (it.hasNext()) it.next().setTrashed(true);
}
function lire_(dossier) {
  const out = {};
  const it = dossier.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const v = f.getBlob().getDataAsString();
    out[f.getName().replace(/\\.txt$/, '')] = /^\\d+$/.test(v) ? Number(v) : v;
  }
  return out;
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`;
