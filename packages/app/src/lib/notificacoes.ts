/**
 * Lembretes de atualização — notificação local, agendada no próprio aparelho.
 *
 * ## Por que local, e não push do servidor
 *
 * A tentação é a notificação que o concorrente anuncia: *"fulano deixou de te
 * seguir"*, na hora. Isso é impossível dentro das regras deste projeto e não é
 * uma limitação que dê para contornar com mais trabalho — para saber que fulano
 * saiu **hoje**, alguém precisa ler a lista de seguidores **hoje**, e a lista de
 * seguidores só chega por duas portas: o arquivo de export, que o usuário pede
 * de tempos em tempos, ou a API privada com a sessão do usuário, que é a regra 2
 * do CLAUDE.md e custa a conta de quem instalou o app.
 *
 * O que sabemos, e é honesto notificar, é o tempo: faz N dias desde a última
 * atualização, e o que aconteceu nesse intervalo ainda não foi visto. Esse
 * lembrete não precisa de servidor, de Firebase, de certificado da Apple nem de
 * token nenhum — o agendamento mora no aparelho e sobrevive a reinício.
 *
 * ## Cuidado com a permissão
 *
 * A permissão de notificação é pedida **uma vez só** pelo sistema. Se for negada,
 * o app não consegue pedir de novo: só resta mandar o usuário nos ajustes do
 * aparelho. Por isso ela é pedida quando a pessoa liga o lembrete, nunca na
 * abertura do app — pedir de cara é o jeito mais rápido de perder a permissão
 * para sempre com quem só queria ver a tela.
 */

import { Platform } from 'react-native';
import { lerAjuste, salvarAjuste } from './storage';

/** Onde a preferência fica entre aberturas. Prefixo `rastro:` para o clear do web. */
const CHAVE_INTERVALO = 'rastro:lembreteDias';

/** Opções oferecidas na tela. Menos que 7 dias vira ruído: o export demora até 48h. */
export const INTERVALOS = [
  { dias: 7, rotulo: 'Toda semana' },
  { dias: 15, rotulo: 'A cada 15 dias' },
  { dias: 30, rotulo: 'Todo mês' },
] as const;

export type IntervaloDeLembrete = (typeof INTERVALOS)[number]['dias'];

export type ResultadoDoLembrete =
  | { ok: true }
  | { ok: false; motivo: 'indisponivel' | 'sem-permissao' | 'falhou' };

/** Hora local em que o lembrete toca. 10h evita acordar alguém às 3 da manhã. */
const HORA_DO_LEMBRETE = 10;

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Distância mínima até o lembrete tocar.
 *
 * Existe para quem liga a opção já atrasado: sem piso, o alvo cairia no passado,
 * o sistema dispararia na hora e a primeira experiência com o recurso seria uma
 * notificação na cara de quem acabou de tocar no botão.
 */
const ESPERA_MINIMA_MS = 12 * 60 * 60 * 1000;

/**
 * No navegador não há notificação local agendada — a Web Notifications API
 * precisa da aba aberta, e um service worker com push exige VAPID e servidor,
 * que é justamente o que este recurso não usa. A tela some no web em vez de
 * oferecer um botão que não faz nada.
 */
export function lembretesDisponiveis(): boolean {
  return Platform.OS !== 'web';
}

/**
 * Carrega o expo-notifications só quando for usar.
 *
 * Import estático aqui traria o módulo (e os efeitos de registro que ele executa
 * ao ser importado) para dentro do bundle do navegador, onde nada disso funciona.
 * É o mesmo cuidado que o `storage.ts` tem com o expo-file-system, e pela mesma
 * razão: efeito de módulo roda antes de qualquer `if (Platform.OS === ...)`.
 */
async function modulo() {
  return import('expo-notifications');
}

/**
 * Canal do Android. Sem canal, o Android 8+ descarta a notificação em silêncio —
 * ela é agendada, o código não reclama, e nada aparece na tela do usuário.
 */
async function garantirCanal(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const Notifications = await modulo();
  await Notifications.setNotificationChannelAsync('lembretes', {
    name: 'Lembretes de atualização',
    importance: Notifications.AndroidImportance.DEFAULT,
    // Sem vibração: é um lembrete de rotina, não um alerta.
    vibrationPattern: [0],
    sound: null,
  });
}

/**
 * Faz a notificação aparecer também com o app aberto.
 *
 * O padrão do expo-notifications é engolir a notificação quando o app está em
 * primeiro plano. Como o lembrete pode cair enquanto a pessoa usa o app, deixar
 * o padrão faria o agendamento parecer quebrado em teste.
 */
export async function prepararNotificacoes(): Promise<void> {
  if (!lembretesDisponiveis()) return;
  try {
    const Notifications = await modulo();
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    await garantirCanal();
  } catch {
    // Notificação é acessório. Se o módulo nativo não estiver presente (Expo Go,
    // por exemplo), o app inteiro precisa continuar abrindo.
  }
}

/** Intervalo escolhido, ou `null` se o lembrete está desligado. */
export async function lerIntervalo(): Promise<IntervaloDeLembrete | null> {
  const salvo = await lerAjuste(CHAVE_INTERVALO);
  if (!salvo) return null;
  const dias = Number(salvo);
  return INTERVALOS.some((i) => i.dias === dias) ? (dias as IntervaloDeLembrete) : null;
}

/**
 * Quando o lembrete deve tocar.
 *
 * A conta parte da última atualização, não de agora: quem já está atrasado
 * precisa ser lembrado logo, não daqui a mais um ciclo inteiro.
 *
 * `setHours`/`setDate` operam no calendário local, e não em aritmética de
 * milissegundos, de propósito: assim o horário continua sendo 10h da manhã do
 * usuário mesmo na semana em que o horário de verão entra ou sai.
 *
 * Exportada para teste — é a única parte deste arquivo que dá para verificar sem
 * um aparelho, e é onde erram os cálculos de data.
 */
export function quandoTocar(dias: number, ultimaAtualizacao: number | null, agora = Date.now()): Date {
  const base = ultimaAtualizacao ?? agora;
  const alvo = new Date(base + dias * DIA_MS);
  alvo.setHours(HORA_DO_LEMBRETE, 0, 0, 0);

  const minimo = agora + ESPERA_MINIMA_MS;
  if (alvo.getTime() >= minimo) return alvo;

  // Atrasado: joga para o próximo horário de lembrete que respeite o piso.
  // Sem laço — quem voltou ao app depois de um ano daria centenas de voltas.
  const proximo = new Date(minimo);
  proximo.setHours(HORA_DO_LEMBRETE, 0, 0, 0);
  if (proximo.getTime() < minimo) proximo.setDate(proximo.getDate() + 1);
  return proximo;
}

/**
 * Agenda o lembrete, cancelando o anterior.
 *
 * `cancelAllScheduledNotificationsAsync` é seguro porque este é o único
 * agendamento do app. Se algum dia houver um segundo, isto precisa passar a
 * guardar e cancelar o id específico — senão um recurso apaga o outro.
 */
async function agendar(dias: number, ultimaAtualizacao: number | null): Promise<void> {
  const Notifications = await modulo();
  await Notifications.cancelAllScheduledNotificationsAsync();
  await garantirCanal();

  const quando = quandoTocar(dias, ultimaAtualizacao);

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Hora de atualizar o Rastro',
      /*
       * O texto avisa da espera de propósito. Sem isso, a pessoa abre o app
       * esperando ver novidade agora, descobre que precisa pedir o arquivo ao
       * Instagram e esperar até 48h, e o lembrete vira frustração em vez de ajuda.
       */
      body: 'Peça um arquivo novo ao Instagram para ver quem entrou e quem saiu. Ele pode levar até 48h para ficar pronto.',
      sound: false,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: quando,
      ...(Platform.OS === 'android' ? { channelId: 'lembretes' } : {}),
    },
  });
}

/**
 * Liga o lembrete: pede permissão se preciso, agenda e guarda a preferência.
 *
 * A preferência só é gravada depois do agendamento dar certo. Gravar antes
 * deixaria a tela mostrando um lembrete ligado que não existe no sistema.
 */
export async function ativarLembrete(
  dias: IntervaloDeLembrete,
  ultimaAtualizacao: number | null,
): Promise<ResultadoDoLembrete> {
  if (!lembretesDisponiveis()) return { ok: false, motivo: 'indisponivel' };

  try {
    const Notifications = await modulo();

    const atual = await Notifications.getPermissionsAsync();
    // `canAskAgain` falso significa que o usuário já negou antes: pedir de novo
    // não abre diálogo nenhum e a função volta negada na hora.
    const concedida =
      atual.granted || (atual.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);

    if (!concedida) return { ok: false, motivo: 'sem-permissao' };

    await agendar(dias, ultimaAtualizacao);
    await salvarAjuste(CHAVE_INTERVALO, String(dias));
    return { ok: true };
  } catch {
    return { ok: false, motivo: 'falhou' };
  }
}

/** Desliga o lembrete e cancela o que estava agendado. */
export async function desativarLembrete(): Promise<void> {
  await salvarAjuste(CHAVE_INTERVALO, null);
  if (!lembretesDisponiveis()) return;
  try {
    const Notifications = await modulo();
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // Preferência já saiu; o agendamento órfão expira sozinho.
  }
}

/**
 * Reancora o lembrete depois de um import.
 *
 * Sem isto o lembrete continuaria contando a partir da atualização anterior e
 * tocaria logo depois de a pessoa ter acabado de atualizar — o jeito mais rápido
 * de alguém desligar a notificação e nunca mais ligar.
 */
export async function reagendarLembrete(ultimaAtualizacao: number): Promise<void> {
  if (!lembretesDisponiveis()) return;
  const dias = await lerIntervalo();
  if (!dias) return;
  try {
    await agendar(dias, ultimaAtualizacao);
  } catch {
    // Ver acima: lembrete é acessório, nunca derruba o import.
  }
}

/**
 * Limpa tudo ao sair ou apagar a conta.
 *
 * Um lembrete sobrevivente falaria com quem não usa mais o app — e, no caso da
 * exclusão de conta, seria o app insistindo com alguém que pediu para sumir.
 */
export async function esquecerLembretes(): Promise<void> {
  await desativarLembrete();
}
