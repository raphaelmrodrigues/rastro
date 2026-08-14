/**
 * Corte de versão mínima do app.
 *
 * ## Por que isto existe
 *
 * Um app publicado nunca some do aparelho de quem instalou. Sem um corte no
 * servidor, uma versão antiga continua funcionando para sempre — o que importa
 * em três situações concretas:
 *
 * 1. **Cobrança.** Quando o Rastro passar a ser pago, quem tem a versão gratuita
 *    instalada continuaria usando de graça. Como o app não abre sem sessão, é
 *    aqui que essa decisão se aplica de verdade.
 * 2. **Formato de dados.** Se o payload do snapshot mudar, versões antigas
 *    enviariam algo que o servidor não entende mais.
 * 3. **Falha de segurança** numa versão específica.
 *
 * ## Como se comporta
 *
 * `VERSAO_MINIMA_APP` vazia (o padrão) desliga a verificação. Isso é
 * deliberado: enquanto não houver motivo para cortar, ninguém é cortado — e um
 * corte configurado por engano derrubaria todos os usuários de uma vez.
 *
 * Requisição sem o cabeçalho passa. Versões anteriores à v1.0 não o enviam, e
 * recusá-las seria travar o app do dono antes de qualquer usuário existir.
 * Quando o corte importar de verdade, ele só será atingível por quem tem o
 * cabeçalho — ou seja, exatamente as versões que sabem mostrar a tela de
 * atualização.
 */

/** Compara "1.2.3" com "1.10.0" corretamente — comparação de texto não serve. */
export function versaoMenorQue(versao: string, minima: string): boolean {
  const partes = (v: string) =>
    v
      .split('.')
      .slice(0, 3)
      .map((n) => Number.parseInt(n, 10) || 0);

  const a = partes(versao);
  const b = partes(minima);

  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/**
 * Decide se a requisição deve ser recusada.
 *
 * Devolve `null` quando pode seguir, ou a versão mínima exigida quando não.
 */
export function versaoRecusada(cabecalho: string | undefined): string | null {
  const minima = (process.env.VERSAO_MINIMA_APP ?? '').trim();
  if (!minima) return null;
  if (!cabecalho) return null;
  return versaoMenorQue(cabecalho.trim(), minima) ? minima : null;
}
