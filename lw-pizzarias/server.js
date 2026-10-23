'use strict';
/**
 * LW Pizzarias - servidor único, sem dependências (Node 18+).
 *  - Entrega o site (public/index.html)
 *  - Guarda cardápio/configurações e pedidos em arquivos JSON (DATA_DIR)
 *  - Painel admin protegido por login no servidor (senha em variável de ambiente)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PROD = process.env.NODE_ENV === 'production';
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // ligue atrás de Render/Railway/Fly/Nginx
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
if (ADMIN_PASSWORD.length < 10) {
  console.error('ERRO: defina a variável ADMIN_PASSWORD com pelo menos 10 caracteres.');
  process.exit(1);
}

// ---------- senha (scrypt + comparação em tempo constante) ----------
const SALT = crypto.randomBytes(16);
const PASS_HASH = crypto.scryptSync(ADMIN_PASSWORD, SALT, 64);
function checkPassword(pw) {
  return new Promise(resolve => {
    crypto.scrypt(String(pw).slice(0, 200), SALT, 64, (err, h) => resolve(!err && crypto.timingSafeEqual(h, PASS_HASH)));
  });
}

// ---------- armazenamento (gravação atômica) ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJSON = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o)); fs.renameSync(t, f); };
let store = readJSON(STORE_FILE, null);                       // { products, crusts, addons, coupons, config }
let ordersDb = readJSON(ORDERS_FILE, { seq: 0, list: [] });   // { seq, list }

// ---------- Firebase (Firestore) ----------
// Ativado quando existir FIREBASE_SERVICE_ACCOUNT (JSON ou JSON em base64) ou GOOGLE_APPLICATION_CREDENTIALS.
// Só o SERVIDOR acessa o banco (Admin SDK); o navegador do cliente nunca fala direto com o Firebase.
const FS_ORDERS = process.env.FIREBASE_ORDERS_COLLECTION || 'pedidos';
const FS_COUNTERS = 'contadores';
let fs_db = null, FsTimestamp = null;
(function initFirebase() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim(), file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!raw && !file) return;
  try {
    const { initializeApp, cert, applicationDefault } = require('firebase-admin/app');
    const { getFirestore, Timestamp } = require('firebase-admin/firestore');
    const json = raw ? JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')) : null;
    initializeApp({ credential: json ? cert(json) : applicationDefault() });
    fs_db = getFirestore(); fs_db.settings({ ignoreUndefinedProperties: true }); FsTimestamp = Timestamp;
    console.log('Firebase (Firestore) conectado: pedidos serão gravados na coleção "' + FS_ORDERS + '".');
  } catch (e) {
    console.error('ERRO ao iniciar o Firebase — usando somente o arquivo local:', e.message);
    fs_db = null;
  }
})();
const pad = (n, w) => String(n).padStart(w, '0');
const iso = v => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v);

// Converte pedidos antigos (versão sem Firebase) para o formato novo, só para exibir no painel.
function legacyOrder(o) {
  if (!o || o.itens) return o;
  return {
    id: o.id, codigo: String(o.id || '').replace('ORD-', ''), numero: null, criadoEm: o.createdAt, data: '', horario: o.time || '',
    cliente: { nome: o.customerName || '' },
    itens: (o.items || []).map(i => ({ quantidade: i.qty, nome: i.name, tamanho: i.size, borda: i.crust && i.crust.name, adicionais: (i.addons || []).map(a => a.name), saches: i.sachets, combo: i.combo, observacao: i.obs })),
    entrega: null, pagamento: null, total: o.total, status: o.status || 'Novo', statusFinal: null
  };
}

// Cria o pedido e devolve { id, codigo, numero }. O número é sequencial e nunca repete (transação no Firestore).
async function saveOrder(order) {
  if (fs_db) {
    try {
      const counter = fs_db.collection(FS_COUNTERS).doc('pedidos');
      return await fs_db.runTransaction(async tx => {
        const snap = await tx.get(counter);
        const n = ((snap.exists && snap.data().ultimo) || 0) + 1, id = pad(n, 6);
        const doc = Object.assign({}, order, { numero: n, codigo: pad(n, 4), criadoEm: FsTimestamp.fromDate(new Date(order.criadoEm)) });
        tx.set(counter, { ultimo: n });
        tx.set(fs_db.collection(FS_ORDERS).doc(id), doc);
        return { id, codigo: doc.codigo, numero: n };
      });
    } catch (e) {
      // Firebase fora do ar: o pedido NÃO se perde. Guarda no arquivo local (série "L") e reenvia depois.
      console.error('Firebase indisponível, pedido guardado localmente:', e.message);
      const r = saveLocal(Object.assign({}, order, { pendenteFirebase: true }), 'L');
      return r;
    }
  }
  return saveLocal(order, '');
}
function saveLocal(order, prefix) {
  ordersDb.seq++;
  const n = ordersDb.seq, codigo = prefix + pad(n, 4), id = prefix ? codigo : pad(n, 6);
  const doc = Object.assign({}, order, { id, numero: prefix ? null : n, codigo });
  ordersDb.list.unshift(doc);
  if (ordersDb.list.length > 500) ordersDb.list.length = 500;
  writeJSON(ORDERS_FILE, ordersDb);
  return { id, codigo, numero: doc.numero };
}
async function listOrders() {
  const local = ordersDb.list.map(legacyOrder);
  if (!fs_db) return local;
  const pend = local.filter(o => o.pendenteFirebase);
  try {
    const q = await fs_db.collection(FS_ORDERS).orderBy('criadoEm', 'desc').limit(200).get();
    return pend.concat(q.docs.map(d => Object.assign({ id: d.id }, d.data(), { criadoEm: iso(d.data().criadoEm), finalizadoEm: iso(d.data().finalizadoEm) })));
  } catch (e) { console.error('Falha ao ler pedidos do Firebase:', e.message); return local; }
}
const STATUS_FINAL = ['Entregue', 'Cancelado', 'Não recebido'];
async function setFinalStatus(id, statusFinal) {
  const patch = { statusFinal, status: statusFinal || 'Novo', finalizadoEm: statusFinal ? new Date().toISOString() : null };
  const i = ordersDb.list.findIndex(o => o.id === id);
  if (i >= 0) { Object.assign(ordersDb.list[i], patch); writeJSON(ORDERS_FILE, ordersDb); if (!fs_db || ordersDb.list[i].pendenteFirebase) return true; }
  if (!fs_db) return i >= 0;
  const ref = fs_db.collection(FS_ORDERS).doc(id);
  const snap = await ref.get(); if (!snap.exists) return false;
  await ref.update(Object.assign({}, patch, { finalizadoEm: statusFinal ? FsTimestamp.fromDate(new Date()) : null }));
  return true;
}
// Reenvia ao Firebase os pedidos guardados localmente durante uma queda.
async function syncPending() {
  if (!fs_db) return;
  for (const o of ordersDb.list.filter(x => x.pendenteFirebase)) {
    try {
      const doc = Object.assign({}, o); delete doc.pendenteFirebase; doc.criadoEm = FsTimestamp.fromDate(new Date(o.criadoEm));
      await fs_db.collection(FS_ORDERS).doc(o.id).set(doc);
      o.pendenteFirebase = false; writeJSON(ORDERS_FILE, ordersDb);
    } catch (e) { return; }
  }
}
setInterval(() => syncPending().catch(() => {}), 60000).unref();

// ---------- utilidades de segurança ----------
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const sessions = new Map();                 // sha256(token) -> { created, last }
const SESSION_IDLE = 30 * 60 * 1000, SESSION_MAX = 8 * 3600 * 1000;
setInterval(() => { const n = Date.now(); for (const [k, s] of sessions) if (n - s.last > SESSION_IDLE || n - s.created > SESSION_MAX) sessions.delete(k); }, 60000).unref();

const buckets = new Map();                  // limitador simples por chave
function allow(key, max, windowMs) {
  const n = Date.now(); let b = buckets.get(key);
  if (!b || n > b.reset) b = { count: 0, reset: n + windowMs };
  b.count++; buckets.set(key, b);
  return b.count <= max;
}
setInterval(() => { const n = Date.now(); for (const [k, b] of buckets) if (n > b.reset) buckets.delete(k); for (const [k, l] of lockouts) if (n > l.until && l.fails === 0) lockouts.delete(k); }, 300000).unref();
const lockouts = new Map();                 // ip -> { fails, until }

function clientIp(req) {
  if (TRUST_PROXY) { const x = req.headers['x-forwarded-for']; if (x) return String(x).split(',')[0].trim(); }
  return req.socket.remoteAddress || 'x';
}
const isHttps = req => PROD || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');

function cookies(req) {
  const o = {}; String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return o;
}
function adminSession(req) {
  const t = cookies(req).lw_admin; if (!t) return null;
  const k = sha(t), s = sessions.get(k), n = Date.now();
  if (!s || n - s.last > SESSION_IDLE || n - s.created > SESSION_MAX) { sessions.delete(k); return null; }
  s.last = n; return k;
}
function setCookie(res, req, value, maxAge) {
  res.setHeader('Set-Cookie', `lw_admin=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`);
}

// ---------- validação / sanitização ----------
class Bad extends Error { constructor(m) { super(m || 'Dados inválidos'); this.status = 400; } }
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function clean(v, depth = 0) {
  if (depth > 6) throw new Bad();
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Bad(); return v; }
  if (typeof v === 'string') { if (v.length > 600000) throw new Bad(); return v; }
  if (Array.isArray(v)) { if (v.length > 500) throw new Bad(); return v.map(x => clean(x, depth + 1)); }
  if (typeof v === 'object') {
    const keys = Object.keys(v); if (keys.length > 60) throw new Bad();
    const o = {}; for (const k of keys) { if (BAD_KEYS.has(k) || k.length > 60) throw new Bad(); o[k] = clean(v[k], depth + 1); }
    return o;
  }
  throw new Bad();
}
const str = (v, max) => typeof v === 'string' && v.length <= max;
const num = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100000;
const arr = (v, max) => { if (!Array.isArray(v) || v.length > max) throw new Bad(); return v; };
const obj = v => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Bad(); return v; };
const IMG = /^(https?:\/\/[^\s"'<>]{1,2000}|data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+\/=]+)$/;
function shortStrings(o, skip) { for (const k of Object.keys(o)) if (k !== skip && typeof o[k] === 'string' && o[k].length > 600) throw new Bad(); }

function validateStore(raw) {
  const b = obj(clean(raw));
  arr(b.products, 300).forEach(p => {
    obj(p); shortStrings(p, 'image');
    if (!str(p.id, 40) || !str(p.name, 120) || !str(p.category, 30) || !num(p.price) || (p.desc != null && !str(p.desc, 600))) throw new Bad();
    if (p.image != null && p.image !== '' && !(str(p.image, 600000) && IMG.test(p.image))) throw new Bad('Imagem inválida');
  });
  for (const key of ['crusts', 'addons']) arr(b[key], 100).forEach(x => {
    obj(x); shortStrings(x);
    if (!str(x.id, 40) || !str(x.name, 60) || !num(x.price) || typeof x.active !== 'boolean') throw new Bad();
  });
  arr(b.coupons, 100).forEach(c => {
    obj(c); shortStrings(c);
    if (!str(c.code, 30) || !/^[A-Z0-9_-]+$/.test(c.code) || !['percentage', 'fixed'].includes(c.type) || !num(c.value) || !num(c.minOrder) || typeof c.active !== 'boolean') throw new Bad();
  });
  const c = obj(b.config); shortStrings(c);
  if (!str(c.name, 80) || !/^[\d+() -]{8,20}$/.test(String(c.phone)) || !num(c.deliveryFee) || !num(c.minOrder) || typeof c.fechadoManual !== 'boolean') throw new Bad();
  for (const k of ['tempoEntrega', 'tempoRetirada']) if (c[k] != null && !str(c[k], 40)) throw new Bad();
  if (c.email != null && !(str(c.email, 80) && (c.email === '' || /^\S+@\S+\.\S+$/.test(c.email)))) throw new Bad();
  arr(c.closedDates || [], 400).forEach(d => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Bad(); });
  arr(c.units || [], 5).forEach(u => { obj(u); for (const k of ['name', 'street', 'number', 'neighborhood']) if (!str(u[k], 80)) throw new Bad(); });
  arr(c.schedules, 7).forEach(s => {
    obj(s);
    if (!Number.isInteger(s.day) || s.day < 0 || s.day > 6 || !str(s.name, 30) || !/^\d{2}:\d{2}$/.test(s.open) || !/^\d{2}:\d{2}$/.test(s.close) || typeof s.isClosed !== 'boolean') throw new Bad();
  });
  return { products: b.products, crusts: b.crusts, addons: b.addons, coupons: b.coupons, config: c };
}
const t = (v, max) => (typeof v === 'string' ? v.replace(/[<>]/g, '').slice(0, max) : '');
const ENTREGAS = { entrega: 'Entrega', retirada: 'Retirada no balcão', consumo: 'Consumo no estabelecimento' };
const PAGAMENTOS = ['Pix', 'Crédito', 'Débito', 'Dinheiro'];
const money = v => Math.round(v * 100) / 100;
const tz = d => ({
  data: d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
  horario: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
});
function validateOrder(raw) {
  const b = obj(clean(raw));
  const cli = obj(b.cliente), nome = t(cli.nome, 80).trim(), telefone = t(cli.telefone, 30).trim();
  if (!nome || telefone.replace(/\D/g, '').length < 10) throw new Bad();
  const itens = arr(b.itens, 40).map(i => {
    obj(i);
    const q = Number(i.quantidade);
    if (!Number.isInteger(q) || q < 1 || q > 99 || !num(i.valorTotal)) throw new Bad();
    const list = (v, n, m) => (Array.isArray(v) ? v.slice(0, n).map(x => t(x, m)).filter(Boolean) : []);
    return {
      quantidade: q, nome: t(i.nome, 200), categoria: t(i.categoria, 30), tamanho: i.tamanho ? t(i.tamanho, 40) : null,
      borda: i.borda ? t(i.borda, 60) : null, adicionais: list(i.adicionais, 20, 60), saches: i.saches == null ? null : list(i.saches, 5, 30),
      combo: i.combo == null ? null : list(i.combo, 10, 250), observacao: t(i.observacao, 300), valorTotal: money(i.valorTotal)
    };
  });
  if (!itens.length) throw new Bad();
  const ent = obj(b.entrega), tipo = String(ent.tipo);
  if (!ENTREGAS[tipo]) throw new Bad();
  let endereco = null;
  if (tipo === 'entrega') {
    const e = obj(ent.endereco);
    endereco = { rua: t(e.rua, 80).trim(), numero: t(e.numero, 15).trim(), bairro: t(e.bairro, 60).trim(), complemento: t(e.complemento, 80).trim() };
    if (!endereco.rua || !endereco.numero || !endereco.bairro) throw new Bad();
  }
  const pg = obj(b.pagamento), forma = String(pg.forma);
  if (!PAGAMENTOS.includes(forma)) throw new Bad();
  if (!num(b.subtotal) || !num(b.desconto) || !num(b.total)) throw new Bad();
  const taxa = tipo === 'entrega' ? money(Number(ent.taxa) || 0) : 0;
  const total = money(b.total);
  let trocoPara = null, trocoADevolver = null;
  if (forma === 'Dinheiro' && pg.trocoPara != null) {
    if (!num(pg.trocoPara) || pg.trocoPara < total) throw new Bad();
    trocoPara = money(pg.trocoPara); trocoADevolver = money(trocoPara - total);
  }
  const now = new Date();
  return Object.assign({
    criadoEm: now.toISOString(),
    cliente: { nome, telefone },
    itens, observacoesGerais: t(b.observacoesGerais, 300),
    entrega: { tipo, rotulo: ENTREGAS[tipo], taxa, endereco },
    pagamento: { forma, trocoPara, trocoADevolver },
    subtotal: money(b.subtotal), desconto: money(b.desconto), cupom: b.cupom ? t(b.cupom, 30) : null, total,
    agendado: b.agendado === true, origem: 'site', status: 'Novo', statusFinal: null, finalizadoEm: null
  }, tz(now));
}

// ---------- HTTP ----------
function send(res, status, body, extra) {
  const isStr = typeof body === 'string';
  res.writeHead(status, Object.assign({ 'Content-Type': isStr ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extra));
  res.end(isStr ? body : JSON.stringify(body));
}
function secHeaders(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let n = 0, big = false; const chunks = [];
    req.on('data', c => { n += c.length; if (n > limit) big = true; else chunks.push(c); });
    req.on('end', () => {
      if (big) return reject(Object.assign(new Error('Muito grande'), { status: 413 }));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); } catch (e) { reject(new Bad('JSON inválido')); }
    });
    req.on('error', reject);
  });
}
const publicStore = () => store ? { initialized: true, products: store.products, crusts: store.crusts, addons: store.addons, config: store.config } : { initialized: false };

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.js': 'text/javascript; charset=utf-8', '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };
function serveStatic(req, res, p) {
  let rel; try { rel = decodeURIComponent(p); } catch (e) { return send(res, 400, { error: 'Pedido inválido' }); }
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, { error: 'Não encontrado' });
  let st; try { st = fs.statSync(full); if (!st.isFile()) throw 0; } catch (e) { return send(res, 404, { error: 'Não encontrado' }); }
  const type = MIME[path.extname(full).toLowerCase()];
  if (!type) return send(res, 404, { error: 'Não encontrado' });
  const head = { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400', 'Accept-Ranges': 'bytes' };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (range[1] || range[2])) { // vídeo precisa de "Range" para tocar/pular no celular
    let start = range[1] ? Number(range[1]) : st.size - Number(range[2]), end = range[1] && range[2] ? Number(range[2]) : st.size - 1;
    end = Math.min(end, st.size - 1);
    if (!(start >= 0 && start <= end)) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
    res.writeHead(206, Object.assign(head, { 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 }));
    return req.method === 'HEAD' ? res.end() : fs.createReadStream(full, { start, end }).pipe(res);
  }
  res.writeHead(200, Object.assign(head, { 'Content-Length': st.size }));
  return req.method === 'HEAD' ? res.end() : fs.createReadStream(full).pipe(res);
}

const INDEX = path.join(__dirname, 'public', 'index.html');

async function handle(req, res) {
  secHeaders(res);
  const url = new URL(req.url, 'http://x'), p = url.pathname, m = req.method, ip = clientIp(req);

  if ((p === '/' || p === '/index.html') && (m === 'GET' || m === 'HEAD')) {
    let html; try { html = fs.readFileSync(INDEX); } catch (e) { return send(res, 500, { error: 'Site não encontrado' }); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(m === 'HEAD' ? undefined : html);
  }
  if ((p.startsWith('/vendor/') || p.startsWith('/media/')) && (m === 'GET' || m === 'HEAD')) return serveStatic(req, res, p);
  if (p === '/healthz') return send(res, 200, { ok: true });
  if (!p.startsWith('/api/')) return send(res, 404, { error: 'Não encontrado' });

  // Proteção contra requisições vindas de outros sites
  if (m !== 'GET' && m !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin) { let h; try { h = new URL(origin).host; } catch (e) { h = ''; } if (h !== req.headers.host) return send(res, 403, { error: 'Origem não permitida' }); }
    if (req.headers['x-lw'] !== '1') return send(res, 403, { error: 'Requisição inválida' });
  }
  if (!allow('g:' + ip, 300, 60000)) return send(res, 429, { error: 'Muitas requisições. Aguarde um pouco.' });

  // ----- público -----
  if (p === '/api/store' && m === 'GET') return send(res, 200, publicStore());

  if (p === '/api/coupon' && m === 'POST') {
    if (!allow('c:' + ip, 20, 60000)) return send(res, 429, { error: 'Muitas tentativas.' });
    const b = obj(await readBody(req, 2000));
    const code = String(b.code || '').trim().toUpperCase().slice(0, 30);
    const c = store && store.coupons.find(x => x.code === code && x.active);
    if (!c) return send(res, 404, { error: 'Cupom inválido ou expirado!' });
    return send(res, 200, { code: c.code, type: c.type, value: c.value, minOrder: c.minOrder, active: true });
  }

  if (p === '/api/orders' && m === 'POST') {
    if (!allow('o:' + ip, 8, 600000)) return send(res, 429, { error: 'Muitos pedidos em pouco tempo.' });
    const o = validateOrder(await readBody(req, 60000));
    const r = await saveOrder(o);
    return send(res, 201, { id: r.id, codigo: r.codigo, numero: r.numero });
  }

  // ----- login / sessão -----
  if (p === '/api/login' && m === 'POST') {
    const l = lockouts.get(ip) || { fails: 0, until: 0 };
    if (l.until > Date.now()) return send(res, 429, { error: `Acesso bloqueado. Tente em ${Math.ceil((l.until - Date.now()) / 60000)} min.` });
    const b = obj(await readBody(req, 1000));
    if (await checkPassword(b.password)) {
      lockouts.delete(ip);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(sha(token), { created: Date.now(), last: Date.now() });
      setCookie(res, req, token, SESSION_MAX / 1000);
      return send(res, 200, { ok: true });
    }
    l.fails++;
    if (l.fails >= 5) { l.until = Date.now() + 15 * 60000; l.fails = 0; }
    lockouts.set(ip, l);
    await new Promise(r => setTimeout(r, 600));
    return send(res, 401, { error: l.until > Date.now() ? 'Muitas tentativas. Bloqueado por 15 minutos.' : 'Senha incorreta!' });
  }
  if (p === '/api/session' && m === 'GET') return send(res, 200, { admin: !!adminSession(req) });
  if (p === '/api/logout' && m === 'POST') {
    const k = adminSession(req); if (k) sessions.delete(k);
    setCookie(res, req, '', 0); return send(res, 200, { ok: true });
  }

  // ----- admin -----
  if (!adminSession(req)) return send(res, 401, { error: 'Sessão expirada. Entre novamente.' });

  if (p === '/api/admin/store' && m === 'GET') return send(res, 200, store ? Object.assign({ initialized: true }, store) : { initialized: false });
  if (p === '/api/admin/store' && m === 'PUT') {
    store = validateStore(await readBody(req, 8 * 1024 * 1024));
    writeJSON(STORE_FILE, store);
    return send(res, 200, { ok: true });
  }
  if (p === '/api/admin/orders' && m === 'GET') return send(res, 200, { orders: await listOrders(), firebase: !!fs_db });
  if (p === '/api/admin/orders' && m === 'DELETE') {
    if (fs_db) return send(res, 409, { error: 'Com o Firebase ativo o histórico é permanente. Apague pelo console do Firebase, se precisar.' });
    ordersDb.list = []; writeJSON(ORDERS_FILE, ordersDb); return send(res, 200, { ok: true });
  }
  const mo = p.match(/^\/api\/admin\/orders\/([A-Za-z0-9_-]{1,20})$/);
  if (mo && m === 'PATCH') {
    const b = obj(await readBody(req, 1000));
    if (b.statusFinal !== null && !STATUS_FINAL.includes(b.statusFinal)) throw new Bad('Status inválido');
    return (await setFinalStatus(mo[1], b.statusFinal)) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'Pedido não encontrado' });
  }

  return send(res, 404, { error: 'Não encontrado' });
}

http.createServer((req, res) => {
  handle(req, res).catch(e => { if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Erro interno' }); else res.end(); if (!e.status) console.error(e); });
}).listen(PORT, () => console.log(`LW Pizzarias no ar: http://localhost:${PORT}`));
