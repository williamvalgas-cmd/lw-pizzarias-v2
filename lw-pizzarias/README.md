# LW Pizzarias — site + servidor (v2)

Servidor Node.js que entrega o site, guarda cardápio/configurações, **grava os pedidos no Firebase (Firestore)** e protege o painel admin com login no servidor.

## Novidades da v2
1. **Abertura cinematográfica 3D** na primeira seção (antes do cardápio).
2. **Banco de dados Firebase** com todos os pedidos.
3. **Nova mensagem do WhatsApp** (modelo Pizzaria LW) e novo modo de entrega: *Consumo no estabelecimento*.
4. Painel de pedidos com **status final**: Entregue / Cancelado / Não recebido.
5. Tempo previsto de entrega e de retirada editáveis no painel (aba Configurações).

## Rodar no computador
```
npm install
ADMIN_PASSWORD="sua-senha-forte" node server.js        # Mac/Linux
$env:ADMIN_PASSWORD="sua-senha-forte"; node server.js   # Windows (PowerShell)
```
Abra http://localhost:3000. Sem as variáveis do Firebase o sistema funciona normalmente, guardando os pedidos em `data/orders.json`.

## Abertura 3D / vídeo
- Por padrão o site mostra uma **cena 3D em tempo real** (pizza fatiada, ingredientes caindo, vapor, câmera de cinema), gerada por código — não precisa de arquivo de vídeo.
- Quer usar um **vídeo seu** (ex.: gerado em Runway, Kling, Veo, Sora ou renderizado no Blender)? Salve-o como `public/media/hero-pizza.mp4` (H.264, 1920×1080, 10–20 s, sem áudio, idealmente < 8 MB). Ele passa a substituir a cena 3D automaticamente; apague o arquivo para voltar à cena 3D.
- Há botão de pausa; com "reduzir movimento" ativado no aparelho a animação já começa parada.
- Para alterar a cena: edite `src/hero3d.js` e rode `npm run build:hero`.

## Firebase — passo a passo
1. Acesse console.firebase.google.com → **Adicionar projeto**.
2. **Build → Firestore Database → Criar banco de dados** (modo *produção*, região `southamerica-east1`).
3. Aba **Regras** do Firestore: cole o conteúdo de `firestore.rules` e publique (bloqueia qualquer acesso direto pelo navegador).
4. **Configurações do projeto → Contas de serviço → Gerar nova chave privada** (baixa um `.json`). Converta para base64:
   - Mac/Linux: `base64 -w0 chave.json`
   - Windows (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("chave.json"))`
5. Na hospedagem, crie a variável `FIREBASE_SERVICE_ACCOUNT` com esse texto. **Nunca** coloque a chave no código/GitHub.
6. Reinicie. No painel admin, o selo ao lado de "Pedidos recebidos" mostra **Firebase ativo**.

### Como os pedidos ficam gravados
Coleção `pedidos`, um documento por pedido (id `000001`, `000002`…):

| Campo | Conteúdo |
|---|---|
| `numero` / `codigo` | número sequencial (1, 2, 3…) / `0001` — gerado em transação, nunca repete |
| `criadoEm`, `data`, `horario` | data e hora (fuso de Brasília) |
| `cliente` | `nome`, `telefone` |
| `itens[]` | `quantidade`, `nome`, `categoria` (pizzas, combos, bebidas, acompanhamentos…), `tamanho`, `borda`, `adicionais[]`, `saches[]`, `combo[]`, `observacao`, `valorTotal` |
| `observacoesGerais` | observação do pedido |
| `entrega` | `tipo` (`entrega`/`retirada`/`consumo`), `rotulo`, `taxa`, `endereco{rua,numero,bairro,complemento}` |
| `pagamento` | `forma` (Pix/Crédito/Débito/Dinheiro), `trocoPara`, `trocoADevolver` |
| `subtotal`, `desconto`, `cupom`, `total` | valores |
| `statusFinal` / `status` | `null`/`Novo` até você marcar **Entregue**, **Cancelado** ou **Não recebido** |
| `finalizadoEm`, `agendado`, `origem` | extras |

O contador fica em `contadores/pedidos`.

### Se o Firebase cair
O pedido **não se perde**: é guardado em `data/orders.json` com número da série `L` (ex.: `L0001`), aparece no painel como "aguardando Firebase" e é reenviado sozinho a cada minuto.

### Histórico
Com o Firebase ativo o botão "Limpar Histórico" some: o histórico é permanente (apague pelo console do Firebase, se precisar).

## Painel admin
Endereço secreto `https://SEU-SITE/#gestor-bc146137e6` (constante `ADMIN_ROUTE` em `public/index.html`). Em **Pedidos recebidos** use os botões Entregue / Cancelado / Não recebido (e "Reabrir").

## Publicar
Hospedagem que execute Node.js (Render, Railway, Fly.io, VPS). Variáveis: `ADMIN_PASSWORD`, `NODE_ENV=production`, `TRUST_PROXY=1`, `FIREBASE_SERVICE_ACCOUNT` (e `DATA_DIR` apontando para disco persistente, usado só no modo sem Firebase/fila de emergência). Comando: `npm start`. Use HTTPS.

## Testes
`npm test` — valida numeração sequencial, validações, status final, queda do Firebase e arquivos estáticos (usa um Firestore simulado, sem internet).

## Limites conhecidos
- O total do pedido vem do navegador do cliente (o pedido real continua confirmado pelo WhatsApp).
- Administrador único (uma senha).
