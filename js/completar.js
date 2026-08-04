/* ============================================================================
   COMPLETAR.JS — Peças que faltavam para o app rodar de ponta a ponta.

   ESTE ARQUIVO NÃO ESTAVA NO ZIP ORIGINAL. Foi escrito agora, só para
   permitir o teste real no navegador, cobrindo exatamente as funções que
   motor.js / exportarPDF.js / exportarExcel.js já citavam como
   "ainda não modularizadas":
     - coletarFaixasJurosComp() / coletarFaixasJurosMora()
     - calcular()
     - bloqueadoPorAuditoria()
   mais a renderização mínima em tela (resumo, memória e auditoria) para o
   teste ficar visível.

   Nenhuma das 8 partes originais foi alterada — este arquivo só orquestra o
   que elas já expõem (montarMemoriaCorrecao, calcularJurosCompensatorios,
   calcularJurosMoratorios, auditarCalculo, configTipoAcao etc.).
============================================================================ */

/* ------------------------------------------------------------------------
   1. FAIXAS DINÂMICAS (juros compensatórios / moratórios)
------------------------------------------------------------------------ */
function lerFaixas(containerId){
  const linhas = document.querySelectorAll('#' + containerId + ' .faixa');

  return Array.from(linhas).map(l => ({
    inicio: l.querySelector('.faixaInicio').value,
    fim: l.querySelector('.faixaFim').value,
    taxa: l.querySelector('.faixaTaxa').value
  })).filter(f => f.inicio || f.fim || f.taxa);
}

function coletarFaixasJurosComp(){
  return lerFaixas('faixasJurosComp');
}

function coletarFaixasJurosMora(){
  return lerFaixas('faixasJurosMora');
}

function adicionarFaixa(containerId){
  const div = document.createElement('div');

  div.className = 'faixa';

  div.innerHTML =
    '<input type="date" class="faixaInicio" title="Início"> ' +
    '<input type="date" class="faixaFim" title="Fim"> ' +
    '<input type="number" step="0.01" class="faixaTaxa" placeholder="% a.a." style="width:70px"> ' +
    '<button type="button" onclick="this.parentElement.remove()">remover</button>';

  $(containerId).appendChild(div);
}

/* ------------------------------------------------------------------------
   2. DEPÓSITOS E LEVANTAMENTOS
------------------------------------------------------------------------ */

function lerDepositos(){
  const linhas = document.querySelectorAll('#depositos .deposito');

  return Array.from(linhas).map(l => ({
    data: l.querySelector('.depData').value,
    valor: parseFloat(l.querySelector('.depValor').value) || 0
  }));
}

function adicionarDeposito(){
  const div = document.createElement('div');

  div.className = 'deposito';

  div.innerHTML =
    '<input type="date" class="depData" title="Data do depósito"> ' +
    '<input type="number" step="0.01" class="depValor" placeholder="Valor do depósito"> ' +
    '<button type="button" onclick="this.parentElement.remove()">remover</button>';

  $('depositos').appendChild(div);
}

function lerLevantamentos(){
  const linhas = document.querySelectorAll('#levantamentos .levantamento');

  return Array.from(linhas).map(l => ({
    data: l.querySelector('.levData').value,
    valor: parseFloat(l.querySelector('.levValor').value) || 0
  }));
}

function adicionarLevantamento(){
  const div = document.createElement('div');

  div.className = 'levantamento';

  div.innerHTML =
    '<input type="date" class="levData"> ' +
    '<input type="number" step="0.01" class="levValor" placeholder="Valor"> ' +
    '<button type="button" onclick="this.parentElement.remove()">remover</button>';

  $('levantamentos').appendChild(div);
}

/* ------------------------------------------------------------------------
   3. bloqueadoPorAuditoria
------------------------------------------------------------------------ */

function bloqueadoPorAuditoria(){

  const auditoria = ULTIMO_CALCULO
    ? (ULTIMO_CALCULO.auditoria || [])
    : [];

  const erros = auditoria.filter(i => i.nivel === 'erro');

  if(!erros.length) return false;

  const painel = $('painelAuditoria');

  if(painel){
    painel.classList.add('destaque');

    try{
      painel.scrollIntoView({
        behavior:'smooth',
        block:'start'
      });
    }catch(_e){}
  }

  const lista = erros
    .map(i => '• ' + i.msg)
    .join('\n\n');

  alert(
    'EXPORTAÇÃO BLOQUEADA — revisão técnica necessária.\n\n' +
    'A revisão técnica automática encontrou ponto(s) crítico(s):\n\n' +
    lista +
    '\n\nCorrija os dados e execute o cálculo novamente antes de gerar PDF, Excel ou impressão.'
  );

  return true;
}

/* ------------------------------------------------------------------------
   3B. ÂNCORA DA CORREÇÃO MONETÁRIA
------------------------------------------------------------------------ */

function resolverAncoraCorrecao(cfg){

  const candidatos = [
    cfg.campoAncoraCorrecao,
    'dataOferta',
    'dataImissao',
    'dataSentenca'
  ].filter(Boolean);

  for(const campoId of candidatos){

    const el = $(campoId);

    if(el && el.value){
      return el.value;
    }
  }

  return null;
}

/* ------------------------------------------------------------------------
   3C. DATA-BASE EFETIVA DO CÁLCULO
------------------------------------------------------------------------ */

function dataBaseEfetiva(){

  const pagamento = $('dataPagamento').value;

  if(pagamento){
    return pagamento;
  }

  return $('dataBase').value ||
         new Date().toISOString().slice(0,10);
}

/* ------------------------------------------------------------------------
   3D. RECÁLCULO INDEPENDENTE DO TOTAL — AUDITORIA
------------------------------------------------------------------------ */

function recalcularTotalParaAuditoria(parcelas){

  const basePrincipal =
    Number(parcelas.diferenca || 0) +
    Number(parcelas.valorBenfeitorias || 0);

  const encargos =
    Number(parcelas.correcao || 0) +
    Number(parcelas.jurosCompensatorios || 0) +
    Number(parcelas.jurosMoratorios || 0) +
    Number(parcelas.honorarios || 0) +
    Number(parcelas.custas || 0);

  const deducaoDeposito =
    Number(parcelas.depositoCorrigido || 0);

  return basePrincipal +
         encargos -
         deducaoDeposito;
}

/* ------------------------------------------------------------------------
   4. calcular() — ORQUESTRAÇÃO PRINCIPAL
------------------------------------------------------------------------ */

async function calcular(){

  try{

    const tipoAcao = $('tipoAcao').value;
    const cfg = configTipoAcao();

    const criterio = $('criterio').value;
    const indice = $('indice').value;

    const taxaManual =
      parseFloat($('taxaManual').value) || 0;

    const incluirMesInicial =
      $('incluirMesInicial').checked;

    const aplicarEC113 =
      $('aplicarEC113').checked;

    const indiceRaw = indice;

    const trechoSentencaIndice =
      $('trechoSentencaIndice').value;

    const dataOferta =
      $('dataOferta').value;

    const dataSentenca =
      $('dataSentenca').value;

    const dataImissao =
      $('dataImissao').value;

    const dataBase =
      $('dataBase').value ||
      new Date().toISOString().slice(0,10);

    const dataPagamento =
      $('dataPagamento').value;

    const dataBaseCalc =
      dataBaseEfetiva();

    /* ---------------------------------------------------------------
       VALORES PRINCIPAIS
    --------------------------------------------------------------- */

    const valorOferta =
      moneyValue('valorOferta');

    const valorSentenca =
      moneyValue('valorSentenca');

    const valorBenfeitorias =
      moneyValue('valorBenfeitorias');

    /*
      NÃO zerar diferença negativa automaticamente.
      A auditoria deve detectar o problema.
    */
    const diferenca =
      valorSentenca - valorOferta;

    const baseValor =
      diferenca + valorBenfeitorias;

    /* ---------------------------------------------------------------
       JUROS
    --------------------------------------------------------------- */

    const aplicarJurosComp =
      $('aplicarJurosComp').checked &&
      cfg.permiteJurosCompensatorios;

    const faixasJurosComp =
      coletarFaixasJurosComp();

    const faixasJurosMora =
      coletarFaixasJurosMora();

    /* ---------------------------------------------------------------
       DEPÓSITOS
    --------------------------------------------------------------- */

    const existeDeposito =
      $('existeDeposito').checked;

    const depositos =
      lerDepositos();

    const valorDepositoTotal =
      depositos
        .filter(d => d.data && d.valor > 0)
        .reduce(
          (s, d) => s + d.valor,
          0
        );

    const levantamentos =
      lerLevantamentos();

    /* ---------------------------------------------------------------
       CORREÇÃO MONETÁRIA
    --------------------------------------------------------------- */

    const ancoraCorrecao =
      resolverAncoraCorrecao(cfg) ||
      dataBase;

    const {
      memoria,
      fonteInfo
    } = await montarMemoriaCorrecao(
      baseValor,
      ancoraCorrecao,
      dataBaseCalc,
      indice,
      taxaManual,
      incluirMesInicial,
      aplicarEC113
    );

    const valorFinalCorrigido =
      memoria.length
        ? memoria[memoria.length - 1].valorCorrigido
        : baseValor;

    const correcao =
      valorFinalCorrigido - baseValor;

    const descCorrecao =
      fonteInfo.detalhe || '—';

    /* ---------------------------------------------------------------
       DEPÓSITOS CORRIGIDOS
    --------------------------------------------------------------- */

    let depositoCorrigido = 0;

    let descDeposito = '—';

    let detalhamentoDeposito = [];

    let avisosDeposito = [];

    if(
      existeDeposito &&
      valorDepositoTotal > 0
    ){

      try{

        const r =
          await calcularDepositosComLevantamentos(
            depositos,
            dataBaseCalc,
            indice,
            taxaManual,
            incluirMesInicial,
            aplicarEC113,
            levantamentos
          );

        depositoCorrigido =
          r.depositoCorrigido;

        detalhamentoDeposito =
          r.detalhamento;

        avisosDeposito =
          r.avisos;

        descDeposito =
          detalhamentoDeposito.length > 1
            ? 'Saldo recalculado por segmentos entre cada depósito complementar e/ou levantamento (ver "Detalhamento do depósito"), somando/deduzindo o valor do evento ao saldo corrigido na respectiva data.'
            : 'Corrigido pelo mesmo índice da correção principal até ' +
              fmtData(dataBaseCalc) +
              '.';

      }catch(e){

        depositoCorrigido =
          valorDepositoTotal;

        descDeposito =
          'Não foi possível corrigir o(s) depósito(s) (' +
          e.message +
          ') — usado o valor nominal somado.';
      }
    }

    /* ---------------------------------------------------------------
       JUROS COMPENSATÓRIOS
    --------------------------------------------------------------- */

    const permitirFallback12 =
      !!(
        $('permitirFallback12') &&
        $('permitirFallback12').checked
      );

    let jurosComp = {
      total: 0,
      desc: '—'
    };

    if(aplicarJurosComp){

      jurosComp =
        calcularJurosCompensatorios(
          baseValor + correcao,
          dataImissao,
          dataBaseCalc,
          criterio,
          permitirFallback12
        );
    }

    /* ---------------------------------------------------------------
       JUROS MORATÓRIOS
    --------------------------------------------------------------- */

    const juros =
      calcularJurosMoratorios(
        baseValor,
        dataOferta,
        dataBaseCalc,
        {
          indiceSelicPeriodoInteiro:
            indice === 'selic',

          usaSwitchEC113:
            !!fonteInfo.usaSwitchEC113,

          criterio
        }
      );

    /* ---------------------------------------------------------------
       HONORÁRIOS E CUSTAS
    --------------------------------------------------------------- */

    const percentualHonor =
      parseFloat(
        $('percentualHonor').value
      ) || 0;

    const limiteHonorPercentual =
      parseFloat(
        ($('limiteHonorPercentual') || {}).value
      ) || 0;

    const custas =
      moneyValue('custas');

    const honorContratualVal =
      moneyValue('honorContratualVal');

    const baseHonor =
      calcularBaseHonoraria(
        cfg.baseHonorariosPadrao,
        {
          diferenca,
          valorSentenca,
          valorBenfeitorias,
          correcao,
          jurosCompTotal:
            jurosComp.total,
          jurosMoraTotal:
            juros.total
        }
      );

    const honorVal =
      baseHonor *
      (percentualHonor / 100);

    const descHonor =
      percentualHonor > 0
        ? (
            percentualHonor
              .toFixed(2)
              .replace('.', ',') +
            '% sobre ' +
            fmt(baseHonor) +
            ' (' +
            cfg.fundamentoHonorarios +
            ')'
          )
        : '—';

    const descJuros =
      (
        juros.desc &&
        juros.desc !== '—' &&
        cfg.fundamentoJurosMora
      )
        ? juros.desc +
          ' (' +
          cfg.fundamentoJurosMora +
          ')'
        : juros.desc;

    /* ---------------------------------------------------------------
       TOTAL OFICIAL
    --------------------------------------------------------------- */

    const total =
      diferenca +
      valorBenfeitorias +
      correcao +
      jurosComp.total +
      juros.total -
      depositoCorrigido +
      honorVal +
      custas;

    /* ---------------------------------------------------------------
       RECÁLCULO INDEPENDENTE
       
       IMPORTANTE:
       NÃO usar "total" aqui.
    --------------------------------------------------------------- */

    const totalRecalculado =
      recalcularTotalParaAuditoria({
        diferenca,
        valorBenfeitorias,
        correcao,
        jurosCompensatorios:
          jurosComp.total,
        jurosMoratorios:
          juros.total,
        depositoCorrigido,
        honorarios:
          honorVal,
        custas
      });

    /* ---------------------------------------------------------------
       CONTEXTO DA AUDITORIA
    --------------------------------------------------------------- */

    const ctx = {

      existeDeposito,
      depositos,

      dataBase:
        dataBaseCalc,

      levantamentos,

      depositoCorrigido,

      totalAntesDeposito:
        total + depositoCorrigido,

      avisosDeposito,

      aplicarJurosComp,

      faixasJurosComp,

      faixasJurosMora,

      dataOferta,

      permitirFallback12,

      jurosCompBloqueadoSemFaixa:
        !!jurosComp.bloqueadoSemFaixa,

      total,

      totalRecalculado,

      indiceRaw,

      trechoSentencaIndice,

      aplicarEC113,

      houveRecortePeriodoInteiro:
        juros.houveRecortePeriodoInteiro,

      houveRecorteEC113:
        juros.houveRecorteEC113,

      dataImissao,

      diferenca,

      valorSentenca,

      dataSentenca,

      percentualHonor,

      limiteHonorPercentual,

      fundamentoJurosMora:
        cfg.fundamentoJurosMora,

      avisoCategoria:
        cfg.avisoCategoria,

      mesesCorrecao:
        memoria.length,

      rotuloAncoraCorrecao:
        cfg.rotuloAncoraCorrecao
    };

    const auditoria =
      auditarCalculo(ctx);

    /* ---------------------------------------------------------------
       OBJETO FINAL
    --------------------------------------------------------------- */

    ULTIMO_CALCULO = {

      identificacao: {

        escritorioNome:
          $('escritorioNome').value,

        advogadoNome:
          $('advogadoNome').value,

        advogadoOAB:
          $('advogadoOAB').value,

        tipoAcao:
          NOMES_TIPO_ACAO[tipoAcao] ||
          tipoAcao,

        numeroProcesso:
          $('numeroProcesso').value,

        comarca:
          $('comarca').value,

        expropriante:
          $('expropriante').value,

        expropriado:
          $('expropriado').value,

        urlValidacao:
          $('urlValidacao').value
      },

      datas: {

        dataOferta,

        dataSentenca,

        dataPagamento,

        dataBase:
          dataBaseCalc,

        dataImissao
      },

      valores: {

        oferta:
          valorOferta,

        sentenca:
          valorSentenca,

        diferenca,

        benfeitoriasNominal:
          valorBenfeitorias,

        correcao,

        jurosComp:
          jurosComp.total,

        juros:
          juros.total,

        depositoCorrigido,

        honorVal,

        custas,

        honorContratualVal,

        total
      },

      descricoes: {

        correcao:
          descCorrecao,

        jurosComp:
          jurosComp.desc,

        juros:
          descJuros,

        deposito:
          descDeposito,

        honor:
          descHonor
      },

      memoria,

      fonteInfo,

      auditoria,

      detalhamentoDeposito
    };

    /* ---------------------------------------------------------------
       RENDERIZAÇÃO
    --------------------------------------------------------------- */

    renderizarResultado(
      ULTIMO_CALCULO
    );

    toast(
      'Cálculo realizado com sucesso.'
    );

    return ULTIMO_CALCULO;

  }catch(err){

    toast(
      'Erro ao calcular: ' +
      err.message,
      true
    );

    console.error(err);

    ULTIMO_CALCULO = null;
  }
}

/* ------------------------------------------------------------------------
   5. RENDERIZAÇÃO MÍNIMA EM TELA
------------------------------------------------------------------------ */

function renderizarResultado(c){

  const avisoDiferencaNegativa =
    c.valores.diferenca < 0

      ? '<p style="color:#8a3324;font-weight:bold">' +
        '⚠ Diferença negativa: o valor da sentença é menor que o da oferta. ' +
        'O valor NÃO foi zerado automaticamente — revise antes de usar este ' +
        'resultado (ver Revisão técnica automática).' +
        '</p>'

      : '';

  let avisoAtualizacaoIndice = '';

  if(
    c.fonteInfo &&
    c.fonteInfo.ultimaAtualizacao
  ){

    const dt =
      new Date(
        c.fonteInfo.ultimaAtualizacao
      );

    const dtFmt =
      isNaN(dt)
        ? c.fonteInfo.ultimaAtualizacao
        : dt.toLocaleString('pt-BR');

    avisoAtualizacaoIndice =
      c.fonteInfo.deCache

        ? `<p style="color:#8a6d1d">
            ⚠ Índice obtido do cache local
            (API do Bacen indisponível no momento do cálculo)
            — dado de ${dtFmt}.
           </p>`

        : `<p style="color:#5b6472">
            Índice atualizado em:
            ${dtFmt}
            (API do Bacen, ao vivo).
           </p>`;
  }

  $('resumoResultado').innerHTML = `

    ${avisoDiferencaNegativa}

    ${avisoAtualizacaoIndice}

    ${
      (
        c.valores.oferta !== 0 ||
        c.valores.sentenca !== 0
      )
        ? `<p>
             <b>Diferença apurada:</b>
             ${fmt(c.valores.diferenca)}
           </p>`
        : ''
    }

    ${
      Math.abs(c.valores.correcao) > 0.004

        ? `<p>
             <b>Correção monetária:</b>
             ${fmt(c.valores.correcao)}
             —
             ${c.descricoes.correcao}
           </p>`

        : ''
    }

    ${
      c.valores.jurosComp > 0

        ? `<p>
             <b>Juros compensatórios:</b>
             ${fmt(c.valores.jurosComp)}
             —
             ${c.descricoes.jurosComp}
           </p>`

        : ''
    }

    ${
      c.valores.juros > 0

        ? `<p>
             <b>Juros moratórios:</b>
             ${fmt(c.valores.juros)}
             —
             ${c.descricoes.juros}
           </p>`

        : ''
    }

    ${
      c.valores.depositoCorrigido > 0

        ? `<p>
             <b>Depósito corrigido (dedução):</b>
             ${fmt(c.valores.depositoCorrigido)}
           </p>`

        : ''
    }

    ${
      c.valores.honorVal > 0

        ? `<p>
             <b>Honorários:</b>
             ${fmt(c.valores.honorVal)}
             —
             ${c.descricoes.honor}
           </p>`

        : ''
    }

    ${
      c.valores.custas > 0

        ? `<p>
             <b>Custas processuais:</b>
             ${fmt(c.valores.custas)}
           </p>`

        : ''
    }

    ${
      c.valores.honorContratualVal > 0

        ? `<p>
             <b>Honorários contratuais (informativo):</b>
             ${fmt(c.valores.honorContratualVal)}
           </p>`

        : ''
    }

    <p style="font-size:1.2em">
      <b>TOTAL: ${fmt(c.valores.total)}</b>
    </p>
  `;

  $('tabelaMemoria').innerHTML =
    '<table border="1" cellpadding="4">' +
      '<tr>' +
        '<th>Competência</th>' +
        '<th>Taxa</th>' +
        '<th>Fator acum.</th>' +
        '<th>Valor corrigido</th>' +
        '<th>Fonte</th>' +
      '</tr>' +

      c.memoria.map(m =>

        `<tr>
          <td>${m.competencia}</td>
          <td>${fmtPct(m.taxa,4)}</td>
          <td>${m.fatorAcumulado.toFixed(6)}</td>
          <td>${fmt(m.valorCorrigido)}</td>
          <td>${m.fonte}</td>
        </tr>`

      ).join('') +

    '</table>';

  /* ---------------------------------------------------------------
     DETALHAMENTO DO DEPÓSITO
  --------------------------------------------------------------- */

  if(
    (c.detalhamentoDeposito || []).length > 1
  ){

    const rotuloEvento =
      ev =>
        ev === 'deposito'
          ? 'Depósito (+)'
          : ev === 'levantamento'
            ? 'Levantamento (−)'
            : '—';

    $('tabelaMemoria').innerHTML +=

      '<h3>' +
        'Detalhamento do depósito ' +
        '(por depósito/levantamento)' +
      '</h3>' +

      '<table border="1" cellpadding="4">' +

        '<tr>' +
          '<th>De</th>' +
          '<th>Até</th>' +
          '<th>Saldo inicial</th>' +
          '<th>Saldo corrigido</th>' +
          '<th>Evento</th>' +
          '<th>Valor do evento</th>' +
          '<th>Saldo remanescente</th>' +
        '</tr>' +

        c.detalhamentoDeposito.map(d =>

          `<tr>
            <td>${fmtData(d.inicio)}</td>
            <td>${fmtData(d.fim)}</td>
            <td>${fmt(d.saldoInicial)}</td>
            <td>${fmt(d.saldoCorrigido)}</td>
            <td>${rotuloEvento(d.evento)}</td>
            <td>${fmt(d.valorEvento)}</td>
            <td>${fmt(d.saldoRemanescente)}</td>
          </tr>`

        ).join('') +

      '</table>';
  }

  /* ---------------------------------------------------------------
     AUDITORIA
  --------------------------------------------------------------- */

  $('painelAuditoria')
    .classList
    .remove('destaque');

  $('painelAuditoria').innerHTML =

    '<h3>Revisão técnica automática</h3>' +

    '<ul>' +

      c.auditoria.map(i =>

        `<li class="niv-${i.nivel}">
          [${i.nivel.toUpperCase()}/${i.categoria}]
          ${i.msg}
        </li>`

      ).join('') +

    '</ul>';
}

/* ------------------------------------------------------------------------
   6. EVENTOS INICIAIS
------------------------------------------------------------------------ */

document.addEventListener(
  'DOMContentLoaded',
  () => {

    $('btnCalcular')
      .addEventListener(
        'click',
        calcular
      );

    document
      .querySelectorAll('input.money')
      .forEach(el => {

        el.addEventListener(
          'input',
          () => formatarMoedaInput(el)
        );

      });

    const campoOab =
      $('advogadoOAB');

    if(campoOab){

      campoOab.addEventListener(
        'input',
        () => formatarOabInput(campoOab)
      );

    }
  }
);