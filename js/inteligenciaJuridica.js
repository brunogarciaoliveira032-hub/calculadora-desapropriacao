/* ============================================================================
   INTELIGENCIAJURIDICA.JS — Fase 5 do checklist.

   Recebe os campos já extraídos por classificadorExtrator.js (regex +
   proximidade) e aplica um segundo nível de leitura, mais "de conteúdo":
     - identificar qual valor é de fato a indenização final (não a oferta,
       nem o depósito, nem o valor pericial — que servem de referência mas
       não são o resultado);
     - se houver acórdão nas páginas, verificar se ele reformou a sentença
       e, se sim, priorizar o valor do acórdão;
     - registrar como alerta (não decide sozinho) quando o índice de
       correção do processo ficou ambíguo (mais de um índice mencionado).

   Este arquivo NUNCA sobrescreve um campo com confiança mais alta por um de
   confiança mais baixa — só ajusta a fonte/confiança quando encontra um
   sinal jurídico mais específico do que a extração bruta já tinha.
   Tudo aqui é heurística de apoio à conferência humana (Fase 6), não uma
   decisão automática definitiva.
============================================================================ */

function aplicarInteligenciaJuridica(campos, paginas){
  detectarReformaAcordao(campos, paginas);
  sinalizarIndiceAmbiguo(campos, paginas);
  distinguirValoresDeReferencia(campos);
  inferirOfertaDoDeposito(campos);
  return campos;
}

/* ------------------------------------------------------------------------
   1. REFORMA DE SENTENÇA EM ACÓRDÃO
   Se há página de acórdão com termos de provimento e um valor de R$ logo
   depois, isso é jurisprudencialmente mais atual que o valor da sentença de
   1º grau — prioriza como valorSentenca (o formulário usa esse campo como
   "valor do título" independente da instância) e explica a troca no trecho.
------------------------------------------------------------------------ */
function detectarReformaAcordao(campos, paginas){
  const paginasAcordao = paginasDoTipo(paginas, 'acordao');
  if(!paginasAcordao.length) return;

  const padroesProvimento = [/dou provimento/i, /dá-se provimento/i, /reformo a sentença/i, /para fixar a indenização em/i];

  for(const p of paginasAcordao){
    const foiProvido = padroesProvimento.some(re => re.test(p.texto || ''));
    if(!foiProvido) continue;

    const r = buscarProximo(p.texto || '', /(?:para fixar a indenização em|passa a ser de)/i, REGEX_VALOR_RS, 100);
    if(r){
      const novoValor = parseValorMoedaBR(r.valorBruto);
      if(novoValor !== null){
        campos.valorSentenca = {
          valor: novoValor,
          confianca: 0.7,
          pagina: p,
          trecho: r.trecho,
          observacao: 'Substituído pelo valor do acórdão — sentença de 1º grau parece ter sido reformada.'
        };
      }
    } else {
      // Não achou o novo valor explícito, mas sinaliza a reforma para o
      // advogado conferir manualmente, sem tocar no valor já extraído.
      campos._alertaReforma = {
        mensagem: 'O acórdão parece dar provimento ao recurso (termos de reforma encontrados), mas não foi possível localizar automaticamente o novo valor da indenização — confira manualmente.',
        pagina: p
      };
    }
    break;
  }
}

/* ------------------------------------------------------------------------
   2. ÍNDICE DE CORREÇÃO AMBÍGUO
   Se mais de um índice (IPCA, IPCA-E, INPC, Selic) aparece nas páginas
   classificadas como sentença/acórdão, marca como ambíguo em vez de
   escolher um dos dois "no escuro" — quem decide é o advogado na
   conferência (Fase 6).
------------------------------------------------------------------------ */
function sinalizarIndiceAmbiguo(campos, paginas){
  const paginasRelevantes = paginasDoTipo(paginas, 'sentenca', 'acordao');
  const encontrados = new Set();
  const alvo = paginasRelevantes.length ? paginasRelevantes : paginas;
  for(const p of alvo){
    const texto = (p.texto || '').toLowerCase();
    if(/ipca-e|ipcae/.test(texto)) encontrados.add('IPCA-E');
    if(/\binpc\b/.test(texto)) encontrados.add('INPC');
    if(/\bipca\b/.test(texto) && !/ipca-e/.test(texto)) encontrados.add('IPCA');
    if(/\bselic\b/.test(texto)) encontrados.add('Selic');
  }
  if(encontrados.size > 1){
    campos._alertaIndiceAmbiguo = {
      mensagem: `Mais de um índice de correção foi mencionado nas peças (${Array.from(encontrados).join(', ')}). Confirme qual se aplica antes de calcular.`
    };
    if(campos.indice) campos.indice.confianca = Math.min(campos.indice.confianca, 0.35);
  }
}

/* ------------------------------------------------------------------------
   3. NÃO CONFUNDIR OFERTA / DEPÓSITO / LAUDO PERICIAL COM A INDENIZAÇÃO
   A extração bruta já separa esses campos (valorOferta, depositoValor,
   valorPericial, valorSentenca) em classificadorExtrator.js. Aqui só
   reforçamos: se por algum motivo valorSentenca não foi encontrado mas
   valorPericial foi, NÃO promovemos o valor pericial a valorSentenca
   automaticamente — laudo pericial é referência técnica, não o título que
   define a indenização (que só vem de sentença/acórdão/acordo homologado).
   Em vez disso, deixamos valorSentenca pendente e sinalizamos a referência
   disponível, para o advogado decidir na conferência.
------------------------------------------------------------------------ */
function distinguirValoresDeReferencia(campos){
  if(!campos.valorSentenca && campos.valorPericial){
    campos._alertaValorPericialDisponivel = {
      mensagem: 'Não foi localizado o valor da indenização em sentença/acórdão, mas há um valor de laudo pericial disponível como referência (não preenchido automaticamente — o laudo é prova técnica, não o título que fixa a indenização).'
    };
  }
}

/* ------------------------------------------------------------------------
   4. OFERTA NÃO MENCIONADA EXPLICITAMENTE, MAS HÁ DEPÓSITO JUDICIAL
   Em desapropriação direta (DL 3.365/41), o depósito prévio costuma ter o
   mesmo valor da oferta administrativa/inicial — mas são conceitos
   juridicamente distintos, então nunca promovemos um pelo outro com
   confiança alta. Se a palavra "oferta" não apareceu em lugar nenhum das
   peças mas há um valor de depósito extraído, preenchemos valorOferta com
   esse valor, com confiança baixa e observação explícita: o advogado
   confirma na conferência (Fase 6) se de fato coincidem neste processo.
------------------------------------------------------------------------ */
function inferirOfertaDoDeposito(campos){
  if(!campos.valorOferta && campos.depositoValor){
    campos.valorOferta = {
      valor: campos.depositoValor.valor,
      confianca: 0.35,
      pagina: campos.depositoValor.pagina,
      trecho: campos.depositoValor.trecho,
      observacao: 'Inferido do depósito judicial inicial — a palavra "oferta" não foi encontrada nas peças. Depósito e oferta costumam ter o mesmo valor no rito do DL 3.365/41, mas são conceitos distintos; confirme antes de usar.'
    };
  }
}
