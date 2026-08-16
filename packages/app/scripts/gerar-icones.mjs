/**
 * Gera os PNG que o sistema operacional exige: ícone da loja, ícone adaptativo
 * do Android, splash e favicon.
 *
 * Por que um script e não arquivos soltos no repositório: o desenho é o mesmo da
 * marca em components/Marca.tsx, e marca que existe duas vezes acaba divergindo.
 * Aqui as coordenadas são as mesmas do SVG, na mesma grade de 32 — mudar a marca
 * e rodar `npm run icones` mantém os dois lados iguais.
 *
 * Por que não usar `sharp` ou `resvg`: são dependências binárias pesadas, que
 * precisariam ser instaladas em toda máquina e no servidor de build, para
 * produzir quatro arquivos que mudam uma vez por ano. O PNG é escrito à mão —
 * o formato, na configuração que usamos (RGBA, sem entrelaçamento, filtro zero),
 * é só um cabeçalho e os pixels comprimidos com zlib, que vem no Node.
 *
 * Uso: npm run icones --workspace @rastro/app
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DESTINO = join(AQUI, '..', 'assets');

// Mesmos valores de lib/theme.ts. Duplicados de propósito: este script roda em
// Node e não pode importar um módulo que o Metro transforma.
const COR = {
  base: [0x15, 0x18, 0x24],
  inkFaint: [0x6b, 0x72, 0x90],
  inkMuted: [0x9b, 0xa1, 0xb8],
  gained: [0xe8, 0xa3, 0x3d],
};

// ---------------------------------------------------------------------------
// PNG

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = TABELA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloco(tipo, dados) {
  const tamanho = Buffer.alloc(4);
  tamanho.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tamanho, corpo, crc]);
}

/** Serializa RGBA (Uint8Array de w*h*4) como PNG. */
function png(largura, altura, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 6; // RGBA
  // 10..12 ficam zerados: compressão deflate, filtro adaptativo, sem entrelaçar.

  // Cada linha recebe um byte de filtro na frente. Zero = sem filtro; o ganho de
  // um filtro melhor não paga a complexidade num arquivo gerado uma vez.
  const bruto = Buffer.alloc((largura * 4 + 1) * altura);
  for (let y = 0; y < altura; y++) {
    const destino = y * (largura * 4 + 1);
    bruto[destino] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * largura * 4, largura * 4).copy(
      bruto,
      destino + 1,
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', deflateSync(bruto, { level: 9 })),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Desenho

class Tela {
  constructor(lado, fundo) {
    this.lado = lado;
    this.px = new Uint8Array(lado * lado * 4);
    if (fundo) {
      for (let i = 0; i < lado * lado; i++) {
        this.px[i * 4] = fundo[0];
        this.px[i * 4 + 1] = fundo[1];
        this.px[i * 4 + 2] = fundo[2];
        this.px[i * 4 + 3] = 255;
      }
    }
  }

  /** Mistura `cor` no pixel com cobertura `a` (0..1), respeitando o alfa existente. */
  ponto(x, y, cor, a) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.lado || y >= this.lado) return;
    const i = (y * this.lado + x) * 4;
    const alfaAtual = this.px[i + 3] / 255;
    const alfaNovo = a + alfaAtual * (1 - a);
    if (alfaNovo <= 0) return;
    for (let c = 0; c < 3; c++) {
      this.px[i + c] = Math.round((cor[c] * a + this.px[i + c] * alfaAtual * (1 - a)) / alfaNovo);
    }
    this.px[i + 3] = Math.round(alfaNovo * 255);
  }

  /**
   * Pinta a região onde `distancia(x,y) <= 0`, com antialiasing.
   *
   * Nove amostras por pixel. É força bruta, mas roda em milissegundos para
   * quatro imagens e evita a matemática de cobertura exata por forma.
   */
  preencher(caixa, distancia, cor) {
    const [x0, y0, x1, y1] = caixa.map((v, i) =>
      i < 2 ? Math.max(0, Math.floor(v)) : Math.min(this.lado, Math.ceil(v)),
    );
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        let dentro = 0;
        for (let sy = 0; sy < 3; sy++) {
          for (let sx = 0; sx < 3; sx++) {
            if (distancia(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3) <= 0) dentro++;
          }
        }
        if (dentro > 0) this.ponto(x, y, cor, dentro / 9);
      }
    }
  }

  circulo(cx, cy, r, cor) {
    this.preencher(
      [cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1],
      (x, y) => Math.hypot(x - cx, y - cy) - r,
      cor,
    );
  }

  /** Segmento de reta com pontas arredondadas. */
  linha(x1, y1, x2, y2, espessura, cor) {
    const r = espessura / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const comprimento2 = dx * dx + dy * dy;
    this.preencher(
      [Math.min(x1, x2) - r - 1, Math.min(y1, y2) - r - 1, Math.max(x1, x2) + r + 1, Math.max(y1, y2) + r + 1],
      (x, y) => {
        const t =
          comprimento2 === 0
            ? 0
            : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / comprimento2));
        return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) - r;
      },
      cor,
    );
  }

  /**
   * Linha tracejada: o traço da marca que representa o intervalo desconhecido.
   *
   * `folgaInicio` e `folgaFim` encurtam o segmento nas pontas, para os traços
   * não nascerem dentro dos círculos que eles ligam.
   */
  tracejada(x1, y1, x2, y2, espessura, cor, traco, vao, folgaInicio = 0, folgaFim = 0) {
    const total = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / total;
    const uy = (y2 - y1) / total;
    const util = total - folgaInicio - folgaFim;
    for (let d = 0; d < util; d += traco + vao) {
      const inicio = folgaInicio + d;
      const fim = folgaInicio + Math.min(d + traco, util);
      this.linha(x1 + ux * inicio, y1 + uy * inicio, x1 + ux * fim, y1 + uy * fim, espessura, cor);
    }
  }
}

/**
 * Caixa que o desenho ocupa de fato dentro da grade de 32, contando o raio dos
 * círculos das pontas.
 *
 * Existe porque a marca não é centrada na grade: ela sobe para a direita e
 * deixa o canto inferior direito vazio, de propósito. Centralizar pela grade,
 * como fiz na primeira versão, jogava tudo para o canto inferior esquerdo do
 * ícone — visível de imediato ao olhar o PNG gerado.
 */
const CAIXA = { x0: 4 - 2, y0: 7 - 3.5, x1: 28 + 3.5, y1: 26 + 2 };

/**
 * Desenha a marca numa tela quadrada, centrada pela caixa acima.
 *
 * `ocupacao` é a fração do lado que o desenho usa. O ícone adaptativo do Android
 * é recortado pelo sistema em círculo, quadrado arredondado ou gota, e só os 66%
 * centrais são garantidos — por isso ele pede um valor menor.
 */
function desenharMarca(tela, ocupacao, corForcada = null) {
  const c = (padrao) => corForcada ?? padrao;
  const largura = CAIXA.x1 - CAIXA.x0;
  const altura = CAIXA.y1 - CAIXA.y0;
  const escala = (tela.lado * ocupacao) / Math.max(largura, altura);
  const esquerda = (tela.lado - largura * escala) / 2 - CAIXA.x0 * escala;
  const topo = (tela.lado - altura * escala) / 2 - CAIXA.y0 * escala;
  const p = (v) => v * escala;
  const px = (v) => esquerda + v * escala;
  const py = (v) => topo + v * escala;
  const e = 2 * escala; // espessura de traço, igual à do SVG

  tela.linha(px(4), py(26), px(11), py(21), e, c(COR.inkFaint));
  tela.linha(px(11), py(21), px(17), py(23), e, c(COR.inkFaint));
  tela.tracejada(
    px(17),
    py(23),
    px(28),
    py(7),
    e,
    c(COR.gained),
    2.2 * escala,
    2.4 * escala,
    4 * escala,
    5 * escala,
  );

  tela.circulo(px(4), py(26), 2 * escala, c(COR.inkFaint));
  tela.circulo(px(11), py(21), 2 * escala, c(COR.inkFaint));
  tela.circulo(px(17), py(23), 2.5 * escala, c(COR.inkMuted));
  tela.circulo(px(28), py(7), 3.5 * escala, c(COR.gained));
}

// ---------------------------------------------------------------------------

function gerar(nome, lado, { fundo, ocupacao, corForcada = null }) {
  const tela = new Tela(lado, fundo);
  desenharMarca(tela, ocupacao, corForcada);
  const caminho = join(DESTINO, nome);
  writeFileSync(caminho, png(lado, lado, tela.px));
  return caminho;
}

mkdirSync(DESTINO, { recursive: true });

const arquivos = [
  // Ícone da loja e do launcher: fundo sólido, o sistema arredonda por fora.
  gerar('icon.png', 1024, { fundo: COR.base, ocupacao: 0.62 }),
  // Camada de frente do ícone adaptativo: transparente, com margem de recorte.
  gerar('adaptive-icon.png', 1024, { fundo: null, ocupacao: 0.44 }),
  // Splash: só a marca, sobre a cor definida em app.json.
  gerar('splash-icon.png', 1024, { fundo: null, ocupacao: 0.5 }),
  gerar('favicon.png', 64, { fundo: COR.base, ocupacao: 0.66 }),
  /*
   * Ícone pequeno da notificação no Android.
   *
   * O Android joga fora as cores deste PNG e usa só o canal alfa como recorte,
   * pintando a silhueta com a cor de destaque do canal. Um ícone colorido vira,
   * literalmente, um quadrado branco na barra de status — é o defeito mais comum
   * de app com notificação, e só aparece no aparelho.
   *
   * Por isso tudo é desenhado em branco opaco sobre transparente: o que importa
   * aqui é o formato, não a cor. Ocupação alta porque em 96px não há recorte do
   * sistema e a marca precisa de todo o espaço para continuar legível.
   */
  gerar('notification-icon.png', 96, {
    fundo: null,
    ocupacao: 0.82,
    corForcada: [0xff, 0xff, 0xff],
  }),
];

for (const caminho of arquivos) console.log('gerado', caminho);
