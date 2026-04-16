// ── Script de Impressão de Pedidos - Império Churrascaria ────
// Roda no PC do restaurante, monitora Firebase e imprime na térmica USB
import 'dotenv/config';
import fetch from 'node-fetch';
import escpos from 'escpos';
import escposUSB from 'escpos-usb';

escpos.USB = escposUSB;

// ── Config ───────────────────────────────────────────────────
var FIREBASE_URL = (process.env.FIREBASE_DB_URL || '').replace(/\/$/, '');
var PREFIX = process.env.FIREBASE_PREFIX || 'imperio';
var INTERVALO = parseInt(process.env.INTERVALO_CHECAGEM || '5') * 1000;
var NOME_RESTAURANTE = process.env.RESTAURANTE_NOME || 'Império Churrascaria';
var TELEFONE = process.env.RESTAURANTE_TELEFONE || '';
var MODO_TESTE = process.argv.includes('--teste');

// Pedidos já impressos (evita reimprimir)
var impressos = new Set();

// ── Firebase helpers ─────────────────────────────────────────
async function fbGet(path) {
  var url = FIREBASE_URL + '/' + PREFIX + '/' + path + '.json';
  var res = await fetch(url);
  if (!res.ok) throw new Error('Firebase GET erro: ' + res.status);
  return res.json();
}

async function fbPatch(path, data) {
  var url = FIREBASE_URL + '/' + PREFIX + '/' + path + '.json';
  var res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Firebase PATCH erro: ' + res.status);
  return res.json();
}

// ── Conectar impressora USB ──────────────────────────────────
function conectarImpressora() {
  try {
    var device = new escpos.USB();
    var printer = new escpos.Printer(device, { encoding: 'CP860' });
    return { device, printer };
  } catch (e) {
    console.error('Erro ao conectar impressora USB:', e.message);
    console.error('Verifique se a impressora esta ligada e conectada.');
    return null;
  }
}

// ── Formatar e imprimir cupom ────────────────────────────────
function imprimirPedido(pedido, pedidoId) {
  return new Promise(function (resolve, reject) {
    var imp = conectarImpressora();
    if (!imp) {
      reject(new Error('Impressora nao encontrada'));
      return;
    }

    var { device, printer } = imp;

    device.open(function (err) {
      if (err) {
        reject(new Error('Erro ao abrir impressora: ' + err.message));
        return;
      }

      try {
        var codigo = pedido.codigoConfirmacao || pedidoId.slice(-6).toUpperCase();
        var data = pedido.criadoEm ? new Date(pedido.criadoEm) : new Date();
        var dataStr = data.toLocaleDateString('pt-BR') + ' ' + data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        printer
          .font('a')
          .align('ct')
          .style('b')
          .size(1, 1)
          .text('================================')
          .text(NOME_RESTAURANTE)
          .text('================================')
          .style('normal')
          .size(0, 0)
          .text(TELEFONE)
          .text(dataStr)
          .text('')
          .align('ct')
          .style('b')
          .size(1, 1)
          .text('PEDIDO #' + codigo)
          .size(0, 0)
          .style('normal')
          .text('--------------------------------');

        // Tipo do pedido
        var tipo = (pedido.tipo || 'retirada').toUpperCase();
        printer
          .align('ct')
          .style('b')
          .text(tipo === 'DELIVERY' ? '>> DELIVERY <<' : '>> RETIRADA <<')
          .style('normal')
          .text('--------------------------------');

        // Cliente
        var cliente = pedido.cliente || {};
        printer
          .align('lt')
          .text('Cliente: ' + (cliente.nome || 'N/I'));

        if (tipo === 'DELIVERY') {
          if (cliente.endereco) printer.text('End: ' + cliente.endereco);
          if (cliente.bairro) printer.text('Bairro: ' + cliente.bairro);
          if (cliente.referencia) printer.text('Ref: ' + cliente.referencia);
          if (cliente.mapsLink) printer.text('Maps: ' + cliente.mapsLink);
        }

        printer.text('Tel: ' + (cliente.telefone || 'N/I'));
        printer.text('--------------------------------');

        // Itens
        printer
          .align('lt')
          .style('b')
          .text('ITENS:')
          .style('normal');

        var itens = pedido.itens || [];
        for (var i = 0; i < itens.length; i++) {
          var item = itens[i];
          var linha = item.qtd + 'x ' + item.nome;
          var precoStr = 'R$ ' + (item.subtotal || (item.preco * item.qtd)).toFixed(2).replace('.', ',');
          printer.text(linha);
          printer.align('rt').text(precoStr).align('lt');
          if (item.obs) {
            printer.text('   OBS: ' + item.obs);
          }
        }

        printer.text('--------------------------------');

        // Totais
        var subtotal = (pedido.subtotal || 0).toFixed(2).replace('.', ',');
        var taxa = (pedido.taxa || 0).toFixed(2).replace('.', ',');
        var total = (pedido.total || 0).toFixed(2).replace('.', ',');

        printer.align('lt');
        printer.text('Subtotal:          R$ ' + subtotal);
        if (pedido.taxa > 0) {
          printer.text('Taxa entrega:      R$ ' + taxa);
        }
        printer
          .text('--------------------------------')
          .style('b')
          .size(1, 1)
          .align('rt')
          .text('TOTAL: R$ ' + total)
          .size(0, 0)
          .style('normal')
          .text('--------------------------------');

        // Pagamento
        var pagamento = (pedido.pagamento || '').toUpperCase();
        printer
          .align('lt')
          .text('Pagamento: ' + pagamento);
        if (pedido.troco) {
          printer.text('Troco para: R$ ' + pedido.troco);
        }

        // Rodapé
        printer
          .text('')
          .align('ct')
          .text('================================')
          .text('Obrigado pela preferencia!')
          .text('================================')
          .text('')
          .text('')
          .cut()
          .close(function () {
            resolve();
          });

      } catch (e) {
        try { device.close(); } catch (ignored) {}
        reject(e);
      }
    });
  });
}

// ── Impressão de teste (sem impressora) ──────────────────────
function imprimirTeste(pedido, pedidoId) {
  var codigo = pedido.codigoConfirmacao || pedidoId.slice(-6).toUpperCase();
  var data = pedido.criadoEm ? new Date(pedido.criadoEm) : new Date();
  var dataStr = data.toLocaleDateString('pt-BR') + ' ' + data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  var cliente = pedido.cliente || {};
  var itens = pedido.itens || [];

  console.log('\n================================');
  console.log('  ' + NOME_RESTAURANTE);
  console.log('================================');
  console.log('  ' + dataStr);
  console.log('');
  console.log('  PEDIDO #' + codigo);
  console.log('--------------------------------');
  console.log('  >> ' + (pedido.tipo || 'retirada').toUpperCase() + ' <<');
  console.log('--------------------------------');
  console.log('Cliente: ' + (cliente.nome || 'N/I'));
  if (pedido.tipo === 'delivery') {
    if (cliente.endereco) console.log('End: ' + cliente.endereco);
    if (cliente.bairro) console.log('Bairro: ' + cliente.bairro);
  }
  console.log('Tel: ' + (cliente.telefone || 'N/I'));
  console.log('--------------------------------');
  console.log('ITENS:');
  for (var i = 0; i < itens.length; i++) {
    var item = itens[i];
    console.log('  ' + item.qtd + 'x ' + item.nome + ' - R$ ' + (item.subtotal || 0).toFixed(2).replace('.', ','));
    if (item.obs) console.log('     OBS: ' + item.obs);
  }
  console.log('--------------------------------');
  console.log('TOTAL: R$ ' + (pedido.total || 0).toFixed(2).replace('.', ','));
  console.log('Pagamento: ' + (pedido.pagamento || '').toUpperCase());
  if (pedido.troco) console.log('Troco para: R$ ' + pedido.troco);
  console.log('================================');
  console.log('  Obrigado pela preferencia!');
  console.log('================================\n');
}

// ── Loop principal - monitorar pedidos ───────────────────────
async function verificarPedidos() {
  try {
    var pedidos = await fbGet('pedidos_abertos');
    if (!pedidos) return;

    var keys = Object.keys(pedidos);
    for (var i = 0; i < keys.length; i++) {
      var id = keys[i];
      var pedido = pedidos[id];

      // Só imprime pedidos novos (não impressos ainda)
      if (impressos.has(id)) continue;
      if (pedido.impresso === true) {
        impressos.add(id);
        continue;
      }

      console.log('Novo pedido detectado: #' + (pedido.codigoConfirmacao || id.slice(-6)));

      try {
        if (MODO_TESTE) {
          imprimirTeste(pedido, id);
        } else {
          await imprimirPedido(pedido, id);
        }

        // Marcar como impresso no Firebase
        await fbPatch('pedidos_abertos/' + id, { impresso: true });
        impressos.add(id);
        console.log('Pedido #' + (pedido.codigoConfirmacao || id.slice(-6)) + ' impresso com sucesso!');

      } catch (e) {
        console.error('ERRO ao imprimir pedido #' + (pedido.codigoConfirmacao || id.slice(-6)) + ':', e.message);
        console.error('Tentando novamente na proxima checagem...');
      }
    }
  } catch (e) {
    console.error('Erro ao buscar pedidos:', e.message);
  }
}

// ── Iniciar ──────────────────────────────────────────────────
console.log('');
console.log('========================================');
console.log('  Impressora de Pedidos - ' + NOME_RESTAURANTE);
console.log('========================================');
console.log('  Firebase: ' + FIREBASE_URL);
console.log('  Prefixo: ' + PREFIX);
console.log('  Modo: ' + (MODO_TESTE ? 'TESTE (sem impressora)' : 'PRODUCAO'));
console.log('  Checando a cada: ' + (INTERVALO / 1000) + 's');
console.log('========================================');
console.log('');

if (!MODO_TESTE) {
  try {
    var devices = escpos.USB.findPrinter();
    if (devices && devices.length > 0) {
      console.log('Impressora USB encontrada! (' + devices.length + ' dispositivo(s))');
    } else {
      console.warn('AVISO: Nenhuma impressora USB encontrada.');
      console.warn('Verifique se esta ligada e conectada.');
      console.warn('Rodando mesmo assim - vai tentar imprimir quando chegar pedido.');
    }
  } catch (e) {
    console.warn('AVISO: Erro ao detectar impressoras:', e.message);
  }
}

// Checar pedidos existentes que já foram impressos
fbGet('pedidos_abertos').then(function (pedidos) {
  if (pedidos) {
    var keys = Object.keys(pedidos);
    for (var i = 0; i < keys.length; i++) {
      if (pedidos[keys[i]].impresso === true) {
        impressos.add(keys[i]);
      }
    }
    console.log(impressos.size + ' pedido(s) ja impresso(s) anteriormente.');
  }
  console.log('Aguardando novos pedidos...\n');
}).catch(function () {
  console.log('Aguardando novos pedidos...\n');
});

// Loop infinito
setInterval(verificarPedidos, INTERVALO);
// Primeira checagem imediata
setTimeout(verificarPedidos, 2000);
