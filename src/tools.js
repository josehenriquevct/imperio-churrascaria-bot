// ── Definição e execução das tools do Gemini ───────────────────
import { config } from './config.js';
import { buscarItem, buscarAdicional, itensPorCategoria } from './cardapio.js';
import {
  getCarrinho, getDados, limparEstado, limparCarrinho,
  totalCarrinho, removerDoCarrinho,
} from './state.js';
import { criarPedidoAberto, upsertCliente, salvarConversa, fb } from './firebase.js';
import { enviarImagem, enviarLocalizacao } from './evolution.js';

// ── Declarações das tools (formato Gemini) ─────────────────────
export const TOOL_DECLARATIONS = [{
  functionDeclarations: [
    {
      name: 'ver_cardapio_categoria',
      description: 'Retorna os itens de uma categoria do cardápio.',
      parameters: {
        type: 'OBJECT',
        properties: {
          categoria: {
            type: 'STRING',
            enum: ['marmitas', 'bebidas', 'adicionais'],
            description: 'Categoria do cardápio',
          },
        },
        required: ['categoria'],
      },
    },
    {
      name: 'enviar_foto_cardapio',
      description: 'Envia a foto/imagem do cardápio completo para o cliente pelo WhatsApp. Use SEMPRE que o cliente pedir para ver o cardápio ou menu.',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'enviar_localizacao_loja',
      description: 'Envia a localização do restaurante como pin no WhatsApp. Use quando o cliente perguntar onde fica ou pedir a localização.',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'adicionar_item',
      description: 'Adiciona um item do cardápio ao pedido atual.',
      parameters: {
        type: 'OBJECT',
        properties: {
          nome_ou_id: { type: 'STRING', description: 'Nome do item ou ID numérico' },
          quantidade: { type: 'NUMBER', description: 'Quantidade' },
          observacao: { type: 'STRING', description: 'Observação opcional (ex: "sem salada")' },
          preco_manual: { type: 'NUMBER', description: 'Preço manual para itens de valor aberto (ex: adicional de churrasco)' },
        },
        required: ['nome_ou_id', 'quantidade'],
      },
    },
    {
      name: 'remover_item',
      description: 'Remove um item do pedido atual pelo nome.',
      parameters: {
        type: 'OBJECT',
        properties: {
          nome: { type: 'STRING', description: 'Nome do item a remover' },
        },
        required: ['nome'],
      },
    },
    {
      name: 'ver_pedido_atual',
      description: 'Retorna o carrinho atual com itens, quantidades e total.',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'salvar_cliente',
      description: 'Salva ou atualiza dados do cliente. Use assim que tiver o nome.',
      parameters: {
        type: 'OBJECT',
        properties: {
          nome: { type: 'STRING' },
          endereco: { type: 'STRING' },
          bairro: { type: 'STRING' },
          referencia: { type: 'STRING' },
        },
        required: ['nome'],
      },
    },
    {
      name: 'definir_tipo_pedido',
      description: 'Define: delivery ou retirada.',
      parameters: {
        type: 'OBJECT',
        properties: {
          tipo: { type: 'STRING', enum: ['delivery', 'retirada'] },
        },
        required: ['tipo'],
      },
    },
    {
      name: 'definir_pagamento',
      description: 'Define a forma de pagamento.',
      parameters: {
        type: 'OBJECT',
        properties: {
          pagamento: { type: 'STRING', enum: ['pix', 'debito', 'credito', 'dinheiro'] },
          troco: { type: 'STRING', description: 'Se dinheiro, valor para troco' },
        },
        required: ['pagamento'],
      },
    },
    {
      name: 'finalizar_pedido',
      description: 'Finaliza o pedido e envia para a cozinha. Requer: itens no carrinho, nome, tipo, pagamento, e endereço (se delivery).',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'cancelar_pedido',
      description: 'Limpa o carrinho atual.',
      parameters: { type: 'OBJECT', properties: {} },
    },
    {
      name: 'transferir_humano',
      description: 'Transfere para atendente humano. Use em reclamações ou pedido explícito.',
      parameters: {
        type: 'OBJECT',
        properties: {
          motivo: { type: 'STRING' },
        },
        required: ['motivo'],
      },
    },
  ],
}];

// ── Executor ───────────────────────────────────────────────────
export async function executarTool(telefone, nome, args) {
  const carrinho = getCarrinho(telefone);
  const dados = getDados(telefone);

  switch (nome) {
    // ── Cardápio ─────────────────────────────────────────────
    case 'ver_cardapio_categoria':
      return await itensPorCategoria(args.categoria);

    case 'enviar_foto_cardapio': {
      try {
        if (!config.cardapioImgUrl) {
          return { sucesso: false, erro: 'Foto do cardápio não configurada. Liste os itens em texto.' };
        }
        await enviarImagem(telefone, config.cardapioImgUrl, 'Nosso cardápio! 🔥🥩');
        console.log(`Foto do cardápio enviada para ${telefone}`);
        return { sucesso: true, mensagem: 'Foto do cardápio enviada com sucesso' };
      } catch (e) {
        console.error('Erro ao enviar foto do cardápio:', e.message);
        return { sucesso: false, erro: 'Não consegui enviar a foto, mas posso listar os itens em texto' };
      }
    }

    case 'enviar_localizacao_loja': {
      try {
        var lat = config.restaurante.lat;
        var lng = config.restaurante.lng;
        if (!lat || !lng) {
          return { sucesso: false, erro: 'Coordenadas da loja não configuradas.' };
        }
        await enviarLocalizacao(telefone, lat, lng, config.restaurante.nome, config.restaurante.endereco);
        console.log('Localizacao da loja enviada para ' + telefone);
        return { sucesso: true, mensagem: 'Localização do restaurante enviada com sucesso' };
      } catch (e) {
        console.error('Erro ao enviar localizacao:', e.message);
        return { sucesso: false, erro: 'Não consegui enviar a localização. Nosso endereço é: ' + config.restaurante.endereco };
      }
    }

    // ── Carrinho ─────────────────────────────────────────────
    case 'adicionar_item': {
      const item = await buscarItem(args.nome_ou_id);
      if (!item) return { sucesso: false, erro: `Item "${args.nome_ou_id}" não encontrado no cardápio.` };
      const qtd = Math.max(1, parseInt(args.quantidade || 1));
      // Suporte a preço manual (para itens de valor aberto como adicional de churrasco)
      const preco = args.preco_manual && args.preco_manual > 0 ? args.preco_manual : item.preco;
      carrinho.push({
        id: item.id,
        nome: item.nome,
        preco: preco,
        qtd,
        obs: args.observacao || '',
        subtotal: preco * qtd,
      });
      return {
        sucesso: true,
        adicionado: `${qtd}x ${item.nome}`,
        preco_unitario: preco,
        subtotal_item: preco * qtd,
        carrinho_total: totalCarrinho(telefone),
      };
    }

    case 'remover_item': {
      const removido = removerDoCarrinho(telefone, args.nome);
      if (!removido) return { sucesso: false, erro: 'Item não encontrado no carrinho' };
      return { sucesso: true, removido: removido.nome };
    }

    case 'ver_pedido_atual': {
      if (!carrinho.length) return { vazio: true };
      const subtotal = totalCarrinho(telefone);
      const taxa = dados.tipo === 'delivery' ? config.restaurante.taxaEntrega : 0;
      return {
        itens: carrinho.map(i => ({ qtd: i.qtd, nome: i.nome, preco: i.preco, obs: i.obs, subtotal: i.subtotal })),
        subtotal,
        taxa_entrega: taxa,
        total: subtotal + taxa,
        tipo: dados.tipo || '',
        cliente: {
          nome: dados.nome || '',
          endereco: dados.endereco || '',
          bairro: dados.bairro || '',
          pagamento: dados.pagamento || '',
        },
      };
    }

    // ── Cliente ──────────────────────────────────────────────
    case 'salvar_cliente': {
      if (args.nome) dados.nome = args.nome;
      if (args.endereco) dados.endereco = args.endereco;
      if (args.bairro) dados.bairro = args.bairro;
      if (args.referencia) dados.referencia = args.referencia;
      return { sucesso: true, cliente: { ...dados } };
    }

    // ── Pedido ───────────────────────────────────────────────
    case 'definir_tipo_pedido': {
      if (args.tipo === 'delivery') {
        try {
          var botCfg = (await fb.get('bot_config/bot')) || {};
          if (botCfg.entregaAtiva === false) {
            return { sucesso: false, erro: 'Entrega DESATIVADA hoje. Ofereça retirada.' };
          }
        } catch (e) {
          console.warn('Erro ao checar config entrega:', e.message);
        }
      }
      dados.tipo = args.tipo;
      return { sucesso: true, tipo: args.tipo };
    }

    case 'definir_pagamento': {
      dados.pagamento = args.pagamento;
      if (args.troco) dados.troco = args.troco;
      return { sucesso: true, pagamento: args.pagamento, troco: dados.troco || '' };
    }

    case 'finalizar_pedido': {
      if (!carrinho.length) return { sucesso: false, erro: 'Carrinho vazio' };
      if (!dados.nome) return { sucesso: false, erro: 'Falta nome do cliente' };
      if (!dados.tipo) return { sucesso: false, erro: 'Falta tipo (delivery/retirada)' };
      if (dados.tipo === 'delivery' && !dados.endereco) return { sucesso: false, erro: 'Falta endereço para delivery' };
      if (!dados.pagamento) return { sucesso: false, erro: 'Falta forma de pagamento' };

      const subtotal = totalCarrinho(telefone);
      const taxa = dados.tipo === 'delivery' ? config.restaurante.taxaEntrega : 0;
      const total = subtotal + taxa;

      try {
        await upsertCliente({
          nome: dados.nome,
          telefone: dados.telefone,
          endereco: dados.endereco || '',
          bairro: dados.bairro || '',
          referencia: dados.referencia || '',
        });
      } catch (e) {
        console.warn('upsertCliente falhou:', e.message);
      }

      const loc = dados.localizacao || null;
      const mapsLink = loc?.lat && loc?.lng
        ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}`
        : '';

      const pedido = {
        itens: carrinho.map(i => ({
          id: i.id,
          nome: i.nome,
          preco: i.preco,
          qtd: i.qtd,
          obs: i.obs || '',
          subtotal: i.subtotal,
        })),
        subtotal,
        taxa,
        desconto: 0,
        total,
        tipo: dados.tipo,
        pagamento: dados.pagamento,
        troco: dados.troco || '',
        cliente: {
          nome: dados.nome,
          telefone: dados.telefone,
          endereco: dados.endereco || '',
          bairro: dados.bairro || '',
          referencia: dados.referencia || '',
          localizacao: loc,
          mapsLink,
        },
      };

      if (dados.modoAgendado) {
        pedido.agendado = true;
        pedido.agendadoPara = dados.horaAbertura || '';
        pedido.status = 'agendado';
      }

      try {
        const criado = await criarPedidoAberto(pedido);
        limparEstado(telefone);

        const instrucaoCodigo = pedido.agendado
          ? `Pedido AGENDADO. Informe ao cliente o código ${criado.codigoConfirmacao}. Vai pro preparo assim que abrirmos as ${pedido.agendadoPara}.`
          : `Informe ao cliente o código de confirmação: ${criado.codigoConfirmacao}. Previsão de entrega: 15 a 25 minutos.`;

        return {
          sucesso: true,
          pedido_id: criado.key,
          total,
          codigoConfirmacao: criado.codigoConfirmacao,
          agendado: !!pedido.agendado,
          agendado_para: pedido.agendadoPara || '',
          instrucao_codigo: instrucaoCodigo,
        };
      } catch (e) {
        return { sucesso: false, erro: 'Falha ao salvar pedido: ' + e.message };
      }
    }

    case 'cancelar_pedido':
      limparCarrinho(telefone);
      return { sucesso: true };

    case 'transferir_humano': {
      await salvarConversa(telefone, { status: 'pausado_humano', motivoTransferencia: args.motivo });
      return { sucesso: true, mensagem: 'Conversa marcada para atendente humano' };
    }

    default:
      return { erro: 'Tool desconhecida: ' + nome };
  }
}
