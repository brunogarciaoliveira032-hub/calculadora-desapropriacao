/* ============================================================================
   CLASSIFICADOREXTRATOR.JS — Classificação de peças (Fase 3) e extração de
   campos (Fase 4).

   ENTRADA: paginas = [{numero, texto, fonte}, ...] (uma por página, de um ou
   mais PDFs já concatenados por lerUmPdf()/painelConferencia.js — cada
   página guarda de qual arquivo/número ela veio, ver campo `origem`).

   SAÍDA:
     classificarPaginas(paginas) -> anota cada página com `.tipos` (lista de
       peças processuais que aquela página parece conter).
     extrairCampos(paginas) -> { campoId: {valor, confianca, pagina, trecho} }

   Nenhuma extração aqui é jurídica no sentido de "decidir o que é correto" —
   isso é papel de inteligenciaJuridica.js. Este arquivo só localiza padrões
   textuais (regex + proximidade a palavras-chave) e atribui uma confiança
   honesta: mesmo o padrão mais forte (nº CNJ) não passa de 0.95, porque
   texto de OCR pode ter erro de reconhecimento de caractere.
============================================================================ */

/* ------------------------------------------------------------------------
   1. CLASSIFICAÇÃO DE PEÇAS (Fase 3)
------------------------------------------------------------------------ */
const PALAVRAS_CLASSIFICACAO = {
  peticaoInicial: ['petição inicial', 'vem, respeitosamente', 'requer a citação', 'dos fatos e fundamentos'],
  contestacao: ['contestação', 'em sede de contestação', 'impugna os termos da inicial'],
  laudoPericial: ['laudo pericial', 'perito judicial', 'quesitos', 'metodologia avaliatória', 'nbr 14.653', 'nbr 14653'],
  sentenca: ['vistos, etc', 'vistos.', 'ante o exposto, julgo', 'dispositivo', 'sentença', 'homologo'],
  acordao: ['acórdão', 'relator(a)', 'turma julgadora', 'dou provimento', 'nego provimento', 'câmara de direito público'],
  depositoJudicial: ['depósito judicial', 'guia de depósito', 'comprovante de depósito', 'levantamento do depósito'],
  matriculaImovel: ['matrícula', 'cartório de registro de imóveis', 'ônus e alienações', 'certidão de inteiro teor']
};

const ROTULOS_CLASSIFICACAO = {
  peticaoInicial: 'Petição inicial',
  contestacao: 'Contestação',
  laudoPericial: 'Laudo pericial',
  sentenca: 'Sentença',
  acordao: 'Acórdão',
  depositoJudicial: 'Depósito judicial',
  matriculaImovel: 'Matrícula do imóvel'
};

function classificarPaginas(paginas){
  paginas.forEach(p => {
    const texto = (p.texto || '').toLowerCase();
    p.tipos = Object.keys(PALAVRAS_CLASSIFICACAO).filter(tipo =>
      PALAVRAS_CLASSIFICACAO[tipo].some(palavra => texto.includes(palavra))
    );
  });
  return paginas;
}

// Devolve as páginas cujo tipo classificado inclui algum dos tipos pedidos.
function paginasDoTipo(paginas, ...tipos){
  return paginas.filter(p => (p.tipos || []).some(t => tipos.includes(t)));
}

/* ------------------------------------------------------------------------
   2. HELPERS DE PARSING (moeda, data, percentual em pt-BR)
------------------------------------------------------------------------ */
function parseValorMoedaBR(str){
  if(!str) return null;
  const limpo = String(str).replace(/[^\d.,]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(limpo);
  return isFinite(n) ? n : null;
}

function formatarValorParaCampoMoeda(n){
  return (isFinite(n) ? n : 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseDataBRParaIso(str){
  const m = String(str).match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if(!m) return null;
  const [, d, mes, a] = m;
  const dia = d.padStart(2, '0'), mesN = mes.padStart(2, '0');
  if(+mesN < 1 || +mesN > 12 || +dia < 1 || +dia > 31) return null;
  return `${a}-${mesN}-${dia}`;
}

// Procura o primeiro casamento de `regexValor` dentro de uma janela de
// `janela` caracteres a partir do fim de QUALQUER casamento de `regexAncora`
// no texto — não só o primeiro. Isso importa porque a mesma palavra-âncora
// (ex.: "honorários sucumbenciais") pode aparecer antes, num trecho
// narrativo sem valor por perto, e de novo mais adiante já associada ao
// valor real (ex.: na tabela da sentença). Parar na primeira ocorrência sem
// valor perdia o campo por completo mesmo com o dado presente na página.
function buscarProximo(texto, regexAncora, regexValor, janela){
  const global = new RegExp(regexAncora.source, regexAncora.flags.includes('g') ? regexAncora.flags : regexAncora.flags + 'g');
  let ma;
  while((ma = global.exec(texto)) !== null){
    const inicio = ma.index + ma[0].length;
    const trecho = texto.slice(inicio, inicio + janela);
    const mv = regexValor.exec(trecho);
    if(mv){
      return { valorBruto: mv[1] !== undefined ? mv[1] : mv[0], trecho: (ma[0] + trecho.slice(0, mv.index + mv[0].length)).slice(-160) };
    }
    if(ma.index === global.lastIndex) global.lastIndex++; // evita loop infinito em casamento de tamanho zero
  }
  return null;
}

/* ------------------------------------------------------------------------
   3. REGEX DE CAMPOS ISOLADOS (não dependem de âncora textual)
------------------------------------------------------------------------ */
const REGEX_NUMERO_PROCESSO = /\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b/;
const REGEX_VALOR_RS = /R\$\s?([\d.]{1,15},\d{2})/;
const REGEX_PERCENTUAL = /(\d{1,3}(?:,\d{1,4})?)\s?%/;
const REGEX_DATA = /(\d{1,2}[\/.]\d{1,2}[\/.]\d{4})/;
const REGEX_AREA = /(?:área(?: total)? de)\s*([\d.]+,\d{2}|\d+)\s?(m²|m2|hectares|ha)\b/i;

/* ------------------------------------------------------------------------
   4. EXTRAÇÃO DE CAMPOS (Fase 4)
   Cada extrator devolve {valor, confianca (0-1), pagina, trecho} ou null.
   `pagina` é o objeto {numero, arquivo} da página onde o campo foi achado,
   para a Fase 6 (conferência) permitir "ver página de origem".
------------------------------------------------------------------------ */
function extrairCampos(paginas){
  classificarPaginas(paginas);
  const campos = {};

  const definir = (id, resultado) => { if(resultado && resultado.valor !== null && resultado.valor !== undefined && resultado.valor !== '') campos[id] = resultado; };

  // --- Número do processo (padrão CNJ) — regex bem específica, alta confiança ---
  for(const p of paginas){
    const m = REGEX_NUMERO_PROCESSO.exec(p.texto || '');
    if(m){ definir('numeroProcesso', { valor: m[1], confianca: 0.95, pagina: p, trecho: contexto(p.texto, m.index, 60) }); break; }
  }

  // --- Comarca / Vara ---
  for(const p of paginas){
    const m = /(?:comarca de|vara (?:única|cível|de fazenda pública|de fazenda))\s*(?:d[eo])?\s*([A-ZÀ-Ú][^\n,.;]{2,60})/i.exec(p.texto || '');
    if(m){ definir('comarca', { valor: (m[0]).trim().replace(/\s+/g, ' '), confianca: 0.6, pagina: p, trecho: contexto(p.texto, m.index, 80) }); break; }
  }

  // --- Autor / Réu (só em petição inicial, para reduzir falso positivo) ---
  const paginasPeticao = paginasDoTipo(paginas, 'peticaoInicial');
  for(const p of paginasPeticao){
    const mAutor = /(?:^|\.)\s*([A-ZÀ-Ú][A-ZÀ-Ú \-\.]{4,80}),?\s+(?:pessoa jurídica|neste ato representad|vem,? respeitosamente)/.exec(p.texto || '');
    if(mAutor){ definir('expropriante', { valor: mAutor[1].trim(), confianca: 0.4, pagina: p, trecho: contexto(p.texto, mAutor.index, 80) }); }
    const mReu = /em face de\s+([A-ZÀ-Ú][A-ZÀ-Ú0-9 \-\.]{4,80})[,.]/.exec(p.texto || '');
    if(mReu){ definir('expropriado', { valor: mReu[1].trim(), confianca: 0.45, pagina: p, trecho: contexto(p.texto, mReu.index, 80) }); }
    if(campos.expropriante && campos.expropriado) break;
  }

  // --- Valor da oferta ---
  for(const p of paginas){
    const r = buscarProximo(p.texto || '', /oferta(?:\s+administrativa|\s+inicial)?/i, REGEX_VALOR_RS, 120);
    if(r){ definir('valorOferta', { valor: parseValorMoedaBR(r.valorBruto), confianca: 0.65, pagina: p, trecho: r.trecho }); break; }
  }

  // --- Valor pericial (informativo — some para a inteligência jurídica comparar) ---
  const paginasLaudo = paginasDoTipo(paginas, 'laudoPericial');
  for(const p of paginasLaudo){
    const r = buscarProximo(p.texto || '', /valor (?:da )?(?:indenização|avaliação)/i, REGEX_VALOR_RS, 100);
    if(r){ definir('valorPericial', { valor: parseValorMoedaBR(r.valorBruto), confianca: 0.6, pagina: p, trecho: r.trecho }); break; }
  }

  // --- Valor da sentença / indenização fixada (prioriza páginas de sentença) ---
  const paginasSentenca = paginasDoTipo(paginas, 'sentenca');
  const anchorsIndenizacao = [/fixo a indenização em/i, /condeno .{0,40} ao pagamento de/i, /valor da indenização/i, /arbitro o valor da indenização em/i];
  for(const p of paginasSentenca){
    for(const ancora of anchorsIndenizacao){
      const r = buscarProximo(p.texto || '', ancora, REGEX_VALOR_RS, 100);
      if(r){ definir('valorSentenca', { valor: parseValorMoedaBR(r.valorBruto), confianca: 0.75, pagina: p, trecho: r.trecho }); break; }
    }
    if(campos.valorSentenca) break;
  }

  // --- Data da oferta / sentença / imissão na posse ---
  definir('dataOferta', extrairDataProxima(paginas, /oferta/i, 0.55));
  definir('dataImissao', extrairDataProxima(paginas, /imissão (?:provisória |definitiva )?na posse/i, 0.6));
  definir('dataSentenca', extrairDataProxima(paginasSentenca.length ? paginasSentenca : paginas, /(?:sentença proferida em|publicada em)/i, 0.5));

  // --- Área do imóvel (informativo — sem campo correspondente no formulário atual) ---
  for(const p of paginas){
    const m = REGEX_AREA.exec(p.texto || '');
    if(m){ definir('areaImovel', { valor: `${m[1]} ${m[2]}`, confianca: 0.55, pagina: p, trecho: contexto(p.texto, m.index, 60), semCampoNoFormulario: true }); break; }
  }

  // --- Índice de correção monetária ---
  for(const p of paginas){
    const texto = (p.texto || '').toLowerCase();
    let indiceAchado = null;
    if(/ipca-e|ipcae/.test(texto)) indiceAchado = 'ipcae';
    else if(/inpc/.test(texto)) indiceAchado = 'inpc';
    else if(/\bipca\b/.test(texto)) indiceAchado = 'ipca';
    else if(/selic/.test(texto)) indiceAchado = 'selic';
    if(indiceAchado){ definir('indice', { valor: indiceAchado, confianca: 0.5, pagina: p, trecho: contexto(p.texto, texto.indexOf(indiceAchado === 'ipcae' ? 'ipca-e' : indiceAchado), 60) }); break; }
  }

  // --- Juros compensatórios (% a.a.) ---
  for(const p of paginas){
    const r = buscarProximo(p.texto || '', /juros compensat[óo]rios/i, REGEX_PERCENTUAL, 60);
    if(r){ definir('faixaCompTaxa', { valor: parseFloat(r.valorBruto.replace(',', '.')), confianca: 0.6, pagina: p, trecho: r.trecho }); break; }
  }

  // --- Juros moratórios (% a.a.) ---
  for(const p of paginas){
    const r = buscarProximo(p.texto || '', /juros morat[óo]rios/i, REGEX_PERCENTUAL, 60);
    if(r){ definir('faixaMoraTaxa', { valor: parseFloat(r.valorBruto.replace(',', '.')), confianca: 0.6, pagina: p, trecho: r.trecho }); break; }
  }

  // --- Honorários sucumbenciais (%) ---
  for(const p of paginas){
    const r = buscarProximo(p.texto || '', /honorários (?:advocatícios|sucumbenciais)/i, REGEX_PERCENTUAL, 60);
    if(r){ definir('percentualHonor', { valor: parseFloat(r.valorBruto.replace(',', '.')), confianca: 0.6, pagina: p, trecho: r.trecho }); break; }
  }

  // --- Depósito judicial (existência + valor + data) ---
  const paginasDeposito = paginasDoTipo(paginas, 'depositoJudicial');
  if(paginasDeposito.length){
    const p = paginasDeposito[0];
    definir('existeDeposito', { valor: true, confianca: 0.7, pagina: p, trecho: contexto(p.texto, 0, 100) });
    const rValor = buscarProximo(p.texto || '', /dep[óo]sito(?: judicial)?/i, REGEX_VALOR_RS, 100);
    if(rValor) definir('depositoValor', { valor: parseValorMoedaBR(rValor.valorBruto), confianca: 0.55, pagina: p, trecho: rValor.trecho });
    const rData = buscarProximo(p.texto || '', /dep[óo]sito(?: judicial)?/i, REGEX_DATA, 80);
    if(rData){
      const isoDeposito = parseDataBRParaIso(rData.valorBruto);
      if(isoDeposito) definir('depositoData', { valor: isoDeposito, confianca: 0.45, pagina: p, trecho: rData.trecho });
    }
  }

  return campos;
}

// Devolve {valor (ISO yyyy-mm-dd), confianca, pagina, trecho} da primeira
// data encontrada perto de `regexAncora`, varrendo `paginas` em ordem, ou
// null se nenhuma página tiver casamento (quem chama decide o que fazer —
// ver `definir()` em extrairCampos, que ignora resultado null).
function extrairDataProxima(paginas, regexAncora, confiancaBase){
  for(const p of paginas){
    const r = buscarProximo(p.texto || '', regexAncora, REGEX_DATA, 80);
    if(r){
      const iso = parseDataBRParaIso(r.valorBruto);
      if(iso) return { valor: iso, confianca: confiancaBase, pagina: p, trecho: r.trecho };
    }
  }
  return null;
}

function contexto(texto, indice, raio){
  if(!texto) return '';
  const ini = Math.max(0, indice - raio);
  const fim = Math.min(texto.length, indice + raio);
  return (ini > 0 ? '…' : '') + texto.slice(ini, fim).trim() + (fim < texto.length ? '…' : '');
}
