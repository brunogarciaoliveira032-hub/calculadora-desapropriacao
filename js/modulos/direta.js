/* ============================================================================
   MODULOS/DIRETA.JS — Regras específicas da Desapropriação (direta)

   Código novo (não extração 1:1) que isola a config de 'desapropriacao' —
   antes hardcoded em MOTORES_TIPO_ACAO, dentro de motor.js — e a registra
   via registrarTipoAcao(). motor.js já foi ajustado para não conter mais
   esta entrada (ver ATUALIZAÇÃO no cabeçalho de motor.js).

   CONTEÚDO (idêntico, campo a campo, à antiga entrada 'desapropriacao' de
   MOTORES_TIPO_ACAO — nenhuma regra jurídica nova, só isolada aqui):
     - Config de negócio da desapropriação direta (exige oferta, exige
       depósito prévio, permite juros compensatórios, fundamentos legais,
       rótulo/nota do termo inicial dos juros compensatórios, base dos
       honorários).

   DEPENDE de:
     - js/motor.js carregado ANTES deste módulo — precisa que
       MOTORES_TIPO_ACAO, NOMES_TIPO_ACAO e registrarTipoAcao() já existam.
============================================================================ */

const CONFIG_DIRETA = {
  label: 'Desapropriação (direta)',
  exigeOferta: true,
  exigeDepositoPossivel: true,
  permiteJurosCompensatorios: true,
  // CORREÇÃO (revisão pericial): antes a âncora da correção monetária estava
  // fixa em 'dataOferta' dentro de completar.js, para TODOS os tipos de ação
  // (ver histórico). Aqui é o único tipo em que isso já era correto — mantido
  // explícito para que a regra fique declarada na config de cada tipo, e não
  // mais hardcoded no orquestrador.
  campoAncoraCorrecao: 'dataOferta',
  rotuloAncoraCorrecao: 'Data da oferta',
  fundamentoJurosComp: 'Súmula 408/STJ (cancelada em 2020 — Pet 12.344/DF — mas a tese equivalente permanece no Tema Repetitivo 126/STJ)',
  rotuloTermoInicialJurosComp: 'Data da imissão provisória na posse',
  notaTermoInicialJurosComp: 'Marco legal da desapropriação direta (art. 15, DL 3.365/41) — termo inicial dos juros compensatórios (Tema 126/STJ, ex-Súmula 408) — Art. 4º.',
  baseHonorariosPadrao: 'diferenca_oferta_sentenca',
  fundamentoHonorarios: 'Súmula 141/STJ — diferença entre a indenização e a oferta, corrigidas monetariamente',
  fundamentoJurosMora: 'art. 15-B, DL 3.365/41 (1º de janeiro do exercício seguinte àquele em que o pagamento deveria ter sido feito — art. 100, CF)',
  avisoCategoria: null
};

registrarTipoAcao('desapropriacao', 'Desapropriação (direta)', CONFIG_DIRETA);
