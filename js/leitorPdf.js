/* ============================================================================
   LEITORPDF.JS — Importação e leitura de PDF (Fase 1 e Fase 2 do checklist)

   Responsabilidade deste arquivo: só ENTRADA e TEXTO BRUTO por página.
   - Fase 1 (Importação): botão "Anexar PDF", drag & drop, múltiplos PDFs,
     barra de progresso, cancelar leitura, histórico de arquivos.
   - Fase 2 (Leitura): leitura de PDF digital (pdf.js), OCR para páginas
     escaneadas (Tesseract.js), limite de 2.000 páginas por arquivo,
     processamento em lotes e liberação de memória entre lotes.

   Classificação (Fase 3), extração de campos (Fase 4) e inteligência
   jurídica (Fase 5) ficam em classificadorExtrator.js e
   inteligenciaJuridica.js. Conferência/preenchimento/relatório (Fases 6-8)
   ficam em painelConferencia.js — este arquivo só entrega o texto por
   página; quem orquestra o pipeline completo é painelConferencia.js.

   LIMITAÇÃO HONESTA SOBRE "OCR OFFLINE" (checklist pede Fase 2 offline):
   o Tesseract.js baixa o motor (wasm) e os dados de idioma ("por.traineddata")
   de uma CDN na primeira vez que roda nesta aba — igual ao jsPDF/xlsx que já
   existiam no app. Isso NÃO é OCR 100% offline "de fábrica". Como o app já é
   um PWA com service worker (sw.js), dá para colocar esses arquivos em cache
   depois da primeira leitura bem-sucedida e então funcionar sem internet nas
   próximas vezes — mas isso ainda não está feito aqui (ver observação no
   relatório da leitura, campo `avisoOffline`). Tratar como pendência real,
   não como algo já entregue.

   DEPENDE de: js/util.js ($, toast). Bibliotecas globais: pdfjsLib
   (pdf.js), Tesseract (Tesseract.js) — carregadas via <script> no index.html
   antes deste arquivo.
============================================================================ */

const LIMITE_PAGINAS_PDF = 2000;
const TAMANHO_LOTE_PAGINAS = 15;       // páginas por lote antes de liberar memória/ceder a UI
const MIN_CARACTERES_TEXTO_DIGITAL = 25; // abaixo disso, a página é tratada como escaneada -> OCR

if(typeof pdfjsLib !== 'undefined'){
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

/* ------------------------------------------------------------------------
   1. ESTADO DA LEITURA (para permitir cancelar entre páginas/lotes)
------------------------------------------------------------------------ */
const LEITOR_PDF_ESTADO = {
  cancelado: false,
  processando: false,
  workerOcr: null // reaproveitado entre páginas/arquivos para não recriar o worker do Tesseract a cada página
};

async function obterWorkerOcr(){
  if(LEITOR_PDF_ESTADO.workerOcr) return LEITOR_PDF_ESTADO.workerOcr;
  const worker = await Tesseract.createWorker('por', 1, {
    logger: () => {} // silencioso; o progresso já é reportado pela barra própria do app
  });
  LEITOR_PDF_ESTADO.workerOcr = worker;
  return worker;
}

async function encerrarWorkerOcr(){
  if(LEITOR_PDF_ESTADO.workerOcr){
    try{ await LEITOR_PDF_ESTADO.workerOcr.terminate(); }catch(e){}
    LEITOR_PDF_ESTADO.workerOcr = null;
  }
}

/* ------------------------------------------------------------------------
   2. UI: progresso, cancelar, drag & drop
------------------------------------------------------------------------ */
function atualizarProgressoLeitura(atual, total, rotulo){
  const wrap = $('leitorProgressoWrap');
  const barra = $('leitorProgressoBarra');
  const texto = $('leitorProgressoTexto');
  wrap.style.display = 'block';
  const pct = total > 0 ? Math.min(100, Math.round((atual / total) * 100)) : 0;
  barra.style.width = pct + '%';
  texto.textContent = rotulo || (`Processando página ${atual} de ${total} (${pct}%)`);
}

function esconderProgressoLeitura(){
  $('leitorProgressoWrap').style.display = 'none';
}

function iniciarUiProcessamento(){
  LEITOR_PDF_ESTADO.processando = true;
  LEITOR_PDF_ESTADO.cancelado = false;
  $('btnCancelarLeitura').style.display = 'inline-block';
  $('btnAnexarPdf').disabled = true;
  $('inputPdf').disabled = true;
}

function encerrarUiProcessamento(){
  LEITOR_PDF_ESTADO.processando = false;
  $('btnCancelarLeitura').style.display = 'none';
  $('btnAnexarPdf').disabled = false;
  $('inputPdf').disabled = false;
}

class LeituraCanceladaError extends Error {
  constructor(){ super('Leitura cancelada pelo usuário.'); this.name = 'LeituraCanceladaError'; }
}

function verificarCancelamento(){
  if(LEITOR_PDF_ESTADO.cancelado) throw new LeituraCanceladaError();
}

// Cede o controle ao navegador entre lotes (repinta a barra de progresso,
// evita a página travar durante PDFs grandes).
function cederControleUi(){
  return new Promise(resolve => setTimeout(resolve, 0));
}

/* ------------------------------------------------------------------------
   3. HISTÓRICO DE ARQUIVOS (Fase 1)
   Guardado em localStorage só com metadados leves (nome, data, contagens) —
   NUNCA o texto extraído do processo, por volume e por prudência com dados
   sensíveis de terceiros que possam constar no PDF.
------------------------------------------------------------------------ */
const CHAVE_HISTORICO_PDF = 'da_historico_leitura_pdf';

function lerHistoricoLeituraPdf(){
  try{
    return JSON.parse(localStorage.getItem(CHAVE_HISTORICO_PDF) || '[]');
  }catch(e){ return []; }
}

function registrarHistoricoLeituraPdf(entrada){
  try{
    const lista = lerHistoricoLeituraPdf();
    lista.unshift(entrada);
    localStorage.setItem(CHAVE_HISTORICO_PDF, JSON.stringify(lista.slice(0, 20)));
  }catch(e){ /* localStorage indisponível/cheio: histórico é cosmético, não bloqueia o app */ }
  renderizarHistoricoLeituraPdf();
}

function renderizarHistoricoLeituraPdf(){
  const container = $('historicoLeituraPdf');
  const lista = lerHistoricoLeituraPdf();
  if(!lista.length){ container.innerHTML = ''; return; }
  const linhas = lista.map(it =>
    `<li><span>${escaparHtml(it.nome)} — ${it.paginas} pág.${it.truncado ? ' (truncado em 2.000)' : ''}</span>` +
    `<span>${it.camposEncontrados}/${it.camposTotal} campos · ${new Date(it.quando).toLocaleString('pt-BR')}</span></li>`
  ).join('');
  container.innerHTML = `<strong>Arquivos já lidos nesta instalação</strong><ul>${linhas}</ul>`;
}

function escaparHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* ------------------------------------------------------------------------
   4. LEITURA DE UM PDF: texto digital + OCR por página, em lotes
------------------------------------------------------------------------ */
// Devolve { nomeArquivo, paginas: [{numero, texto, fonte}], truncado, totalPaginasOriginal, tempoMs }
async function lerUmPdf(arquivo){
  const inicio = performance.now();
  const bytes = await arquivo.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

  const totalPaginasOriginal = pdf.numPages;
  const truncado = totalPaginasOriginal > LIMITE_PAGINAS_PDF;
  const totalAProcessar = Math.min(totalPaginasOriginal, LIMITE_PAGINAS_PDF);

  if(truncado){
    const aviso = $('avisoTruncamento');
    aviso.style.display = 'block';
    aviso.textContent = `"${arquivo.name}" tem ${totalPaginasOriginal} páginas — apenas as primeiras ${LIMITE_PAGINAS_PDF} serão lidas (limite de processamento).`;
  }

  const paginas = [];
  let numeroPagina = 1;

  while(numeroPagina <= totalAProcessar){
    verificarCancelamento();
    const fimDoLote = Math.min(numeroPagina + TAMANHO_LOTE_PAGINAS - 1, totalAProcessar);

    for(let n = numeroPagina; n <= fimDoLote; n++){
      verificarCancelamento();
      atualizarProgressoLeitura(n, totalAProcessar, `Lendo página ${n} de ${totalAProcessar} — "${arquivo.name}"`);

      const pagina = await pdf.getPage(n);
      const conteudoTexto = await pagina.getTextContent();
      let texto = conteudoTexto.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
      let fonte = 'digital';

      if(texto.length < MIN_CARACTERES_TEXTO_DIGITAL){
        // Página provavelmente escaneada (imagem) -> OCR
        atualizarProgressoLeitura(n, totalAProcessar, `OCR na página ${n} de ${totalAProcessar} (sem texto digital) — "${arquivo.name}"`);
        texto = await ocrDaPagina(pagina);
        fonte = 'ocr';
      }

      paginas.push({ numero: n, texto, fonte });

      // Libera referências da página o quanto antes (páginas de PDF grandes
      // seguram recursos internos do pdf.js até o garbage collector passar).
      pagina.cleanup && pagina.cleanup();
    }

    numeroPagina = fimDoLote + 1;
    await cederControleUi(); // deixa a barra repintar e a UI responder antes do próximo lote
  }

  await pdf.destroy();

  const tempoMs = performance.now() - inicio;
  return { nomeArquivo: arquivo.name, paginas, truncado, totalPaginasOriginal, tempoMs };
}

async function ocrDaPagina(pagina){
  const escala = 2; // resolução maior ajuda bastante a precisão do OCR em digitalizações jurídicas
  const viewport = pagina.getViewport({ scale: escala });
  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const contexto = canvas.getContext('2d');

  await pagina.render({ canvasContext: contexto, viewport }).promise;

  const worker = await obterWorkerOcr();
  const { data } = await worker.recognize(canvas);

  // Libera o canvas imediatamente — é a parte mais pesada em memória do lote.
  canvas.width = 0;
  canvas.height = 0;

  return (data && data.text || '').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------------
   5. ORQUESTRAÇÃO: múltiplos arquivos anexados de uma vez
------------------------------------------------------------------------ */
// Devolve um array de resultados de lerUmPdf(), um por arquivo, na ordem em
// que foram anexados. Interrompe tudo (com toast, sem travar o app) se o
// usuário cancelar ou se algum PDF falhar ao abrir.
async function processarArquivosPdf(arquivos){
  if(!arquivos || !arquivos.length) return [];
  if(LEITOR_PDF_ESTADO.processando){
    toast('Já há uma leitura de PDF em andamento.', true);
    return [];
  }

  iniciarUiProcessamento();
  $('avisoTruncamento').style.display = 'none';
  const resultados = [];

  try{
    for(const arquivo of arquivos){
      verificarCancelamento();
      if(arquivo.type !== 'application/pdf' && !arquivo.name.toLowerCase().endsWith('.pdf')){
        toast(`"${arquivo.name}" ignorado (não é um PDF).`, true);
        continue;
      }
      const resultado = await lerUmPdf(arquivo);
      resultados.push(resultado);
    }
    return resultados;
  }catch(erro){
    if(erro instanceof LeituraCanceladaError){
      toast('Leitura cancelada.');
    }else{
      console.error(erro);
      toast('Erro ao ler o PDF: ' + erro.message, true);
    }
    return resultados; // devolve o que já foi processado até o cancelamento/erro
  }finally{
    encerrarUiProcessamento();
    esconderProgressoLeitura();
    await encerrarWorkerOcr(); // não deixa o worker do Tesseract vivo consumindo memória entre leituras
  }
}

/* ------------------------------------------------------------------------
   6. LIGAÇÃO COM A UI (botão, input file, drag & drop, cancelar)
   O disparo do pipeline completo (ler -> classificar -> extrair ->
   inteligência jurídica -> conferência) é feito por
   iniciarPipelineLeituraPdf(arquivos), definido em painelConferencia.js.
------------------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', function(){
  const zona = $('zonaDropPdf');
  const input = $('inputPdf');

  $('btnAnexarPdf').addEventListener('click', () => input.click());
  zona.addEventListener('click', () => input.click());
  zona.addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' ') input.click(); });

  input.addEventListener('change', () => {
    if(input.files && input.files.length){
      const arquivos = Array.from(input.files);
      input.value = ''; // permite reanexar o mesmo arquivo depois
      if(typeof iniciarPipelineLeituraPdf === 'function') iniciarPipelineLeituraPdf(arquivos);
    }
  });

  ['dragenter', 'dragover'].forEach(evento => {
    zona.addEventListener(evento, e => { e.preventDefault(); zona.classList.add('arrastando'); });
  });
  ['dragleave', 'drop'].forEach(evento => {
    zona.addEventListener(evento, e => { e.preventDefault(); zona.classList.remove('arrastando'); });
  });
  zona.addEventListener('drop', e => {
    const arquivos = Array.from(e.dataTransfer.files || []);
    if(arquivos.length && typeof iniciarPipelineLeituraPdf === 'function') iniciarPipelineLeituraPdf(arquivos);
  });

  $('btnCancelarLeitura').addEventListener('click', () => {
    LEITOR_PDF_ESTADO.cancelado = true;
  });

  renderizarHistoricoLeituraPdf();
});
