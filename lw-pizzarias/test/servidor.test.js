// Teste do servidor com um Firestore FALSO em memória (sem internet). Rode: node test/servidor.test.js
const Module = require('module'), os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert');
const MODE = process.argv[2] || 'firebase';       // "firebase" (Firestore falso) ou "arquivo"
const data = {}; let failNext = 0;
const mkRef = (col, id) => ({
  snap: () => ({ exists: !!(data[col] && data[col][id]), data: () => data[col][id] }),
  async get() { return this.snap(); },
  setSync(v) { (data[col] = data[col] || {})[id] = JSON.parse(JSON.stringify(v, (k, x) => x)) && v; },
  async set(v) { this.setSync(v); }, async update(v) { Object.assign(data[col][id], v); }
});
const fakeDb = {
  settings() {},
  collection(col) { return { doc: id => mkRef(col, id), orderBy: () => ({ limit: n => ({ async get() {
    const docs = Object.entries(data[col] || {}).map(([id, v]) => ({ id, data: () => v }));
    docs.sort((a, b) => b.data().criadoEm.toDate() - a.data().criadoEm.toDate()); return { docs: docs.slice(0, n) }; } }) }) }; },
  async runTransaction(fn) {
    if (failNext > 0) { failNext--; throw new Error('Firestore fora do ar (simulado)'); }
    const writes = [], tx = { get: async ref => ref.snap(), set: (ref, v) => writes.push(() => ref.setSync(v)) };
    const r = await fn(tx); writes.forEach(w => w()); return r;
  }
};
const orig = Module._load;
Module._load = function (req) {
  if (req === 'firebase-admin/app') return { initializeApp() {}, cert: x => x, applicationDefault: () => ({}) };
  if (req === 'firebase-admin/firestore') return { getFirestore: () => fakeDb, Timestamp: { fromDate: d => ({ toDate: () => d }) } };
  return orig.apply(this, arguments);
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lw-'));
Object.assign(process.env, { ADMIN_PASSWORD: 'senha-de-teste-123', PORT: '3056', DATA_DIR: tmp });
if (MODE === 'firebase') process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"x"}';
require('../server.js');

const base = 'http://127.0.0.1:3056', H = { 'Content-Type': 'application/json', 'X-LW': '1' };
const pedido = (extra = {}) => Object.assign({
  cliente: { nome: 'Maria', telefone: '(34) 99999-1234' },
  itens: [{ quantidade: 2, nome: 'Calabresa', categoria: 'salgadas', tamanho: 'Grande', borda: 'Catupiry', adicionais: ['Bacon'], saches: ['Ketchup'], combo: null, observacao: 'sem cebola', valorTotal: 90 },
          { quantidade: 1, nome: 'Coca-Cola 2L', categoria: 'bebidas', adicionais: [], observacao: '', valorTotal: 12 }],
  observacoesGerais: 'tocar a campainha',
  entrega: { tipo: 'entrega', taxa: 7, endereco: { rua: 'Rua A', numero: '10', bairro: 'Centro', complemento: 'Apto 2' } },
  pagamento: { forma: 'Dinheiro', trocoPara: 150 }, subtotal: 102, desconto: 0, cupom: null, total: 109, agendado: false
}, extra);
const post = (b, h = H) => fetch(base + '/api/orders', { method: 'POST', headers: h, body: JSON.stringify(b) });
(async () => {
  await new Promise(r => setTimeout(r, 400));
  let r = await post(pedido()); let j = await r.json(); assert.equal(r.status, 201); assert.equal(j.codigo, '0001'); console.log('1º pedido ->', j);
  r = await post(pedido({ entrega: { tipo: 'retirada', taxa: 0 }, pagamento: { forma: 'Pix' }, total: 102 })); j = await r.json(); assert.equal(j.codigo, '0002'); console.log('2º pedido ->', j);
  r = await post(pedido({ entrega: { tipo: 'consumo', taxa: 0 }, pagamento: { forma: 'Crédito' }, total: 102 })); j = await r.json(); assert.equal(j.codigo, '0003');
  // validações
  assert.equal((await post(pedido({ pagamento: { forma: 'Boleto' } }))).status, 400, 'forma de pagamento inválida');
  assert.equal((await post(pedido({ pagamento: { forma: 'Dinheiro', trocoPara: 50 } }))).status, 400, 'troco menor que o total');
  assert.equal((await post(pedido({ entrega: { tipo: 'entrega', taxa: 7, endereco: { rua: '', numero: '1', bairro: 'x' } } }))).status, 400, 'endereço obrigatório');
  assert.equal((await post(pedido(), { 'Content-Type': 'application/json' })).status, 403, 'sem X-LW');
  // login admin
  r = await fetch(base + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ password: 'senha-de-teste-123' }) });
  const cookie = r.headers.get('set-cookie').split(';')[0]; const A = Object.assign({ Cookie: cookie }, H);
  r = await fetch(base + '/api/admin/orders', { headers: A }); j = await r.json();
  console.log('Pedidos no admin:', j.orders.map(o => `${o.codigo}/${o.entrega.rotulo}/${o.pagamento.forma}/${o.status}`).join(' | '), '| firebase:', j.firebase);
  const o1 = j.orders.find(o => o.codigo === '0001');
  assert.equal(o1.pagamento.trocoADevolver, 41); assert.equal(o1.entrega.endereco.bairro, 'Centro'); assert.ok(o1.data && o1.horario);
  // status final
  for (const st of ['Entregue', 'Cancelado', 'Não recebido']) {
    r = await fetch(base + '/api/admin/orders/' + o1.id, { method: 'PATCH', headers: A, body: JSON.stringify({ statusFinal: st }) }); assert.equal(r.status, 200);
    j = await (await fetch(base + '/api/admin/orders', { headers: A })).json(); assert.equal(j.orders.find(o => o.codigo === '0001').statusFinal, st);
  }
  assert.equal((await fetch(base + '/api/admin/orders/' + o1.id, { method: 'PATCH', headers: A, body: JSON.stringify({ statusFinal: 'Qualquer' }) })).status, 400);
  assert.equal((await fetch(base + '/api/admin/orders/999999', { method: 'PATCH', headers: A, body: JSON.stringify({ statusFinal: 'Entregue' }) })).status, 404);
  assert.equal((await fetch(base + '/api/admin/orders/' + o1.id, { method: 'PATCH', headers: H, body: JSON.stringify({ statusFinal: 'Entregue' }) })).status, 401, 'sem login');
  // limpar histórico
  r = await fetch(base + '/api/admin/orders', { method: 'DELETE', headers: A, body: '{}' });
  console.log('DELETE histórico ->', r.status, MODE === 'firebase' ? '(bloqueado com Firebase)' : '(permitido no modo arquivo)');
  assert.equal(r.status, MODE === 'firebase' ? 409 : 200);
  if (MODE === 'firebase') {
    failNext = 1; r = await post(pedido()); j = await r.json(); console.log('Firebase caiu ->', j); assert.equal(r.status, 201); assert.match(j.codigo, /^L\d{4}$/);
    j = await (await fetch(base + '/api/admin/orders', { headers: A })).json(); assert.ok(j.orders.some(o => o.codigo === j.orders[0].codigo && o.pendenteFirebase), 'pendente aparece no painel');
    r = await post(pedido()); j = await r.json(); assert.equal(j.codigo, '0004', 'volta à série normal'); console.log('Voltou ->', j);
  }
  // arquivos estáticos
  r = await fetch(base + '/vendor/hero3d.js'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(base + '/vendor/..%2fserver.js')).status, 404); assert.equal((await fetch(base + '/media/nao-existe.mp4')).status, 404);
  assert.equal((await fetch(base + '/vendor/%2e%2e/%2e%2e/server.js')).status, 404);
  console.log('\nTODOS OS TESTES PASSARAM (' + MODE + ')'); process.exit(0);
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
