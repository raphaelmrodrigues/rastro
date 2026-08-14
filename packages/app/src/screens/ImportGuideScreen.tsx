/**
 * Tela de onboarding do import.
 *
 * Esta é a tela mais importante do produto inteiro. A fricção de pedir o export
 * no Instagram e esperar até 48h é o principal motivo de abandono. Cada palavra
 * aqui existe para reduzir dúvida.
 *
 * Três decisões deliberadas de copy:
 *
 * 1. Dizemos "marque só Seguidores e seguindo" com destaque. Sem isso o usuário
 *    baixa o export completo — mais de 100 MB de fotos e conversas — espera
 *    muito mais tempo e provavelmente desiste.
 *
 * 2. "Todo o período" vem com o mesmo destaque, e é o passo que mais gente erra.
 *    Um export de 12 meses não traz a base completa de seguidores, só quem entrou
 *    dentro da janela. Comparar um export desses com um completo faz o app acusar
 *    centenas de saídas que nunca aconteceram.
 *
 * 3. Explicamos por que não pedimos a senha, logo na primeira tela. O usuário
 *    vem de apps que pedem, e vai estranhar. Transformar a ausência de login em
 *    argumento é a nossa diferenciação.
 *
 * O que NÃO dizemos mais: "só JSON funciona". O app lê os dois formatos. Exigir
 * JSON custava import de gente que já tinha esperado 48h pelo arquivo errado.
 */

import { ScrollView, Text, View, StyleSheet, Pressable, Linking } from 'react-native';
import { colors, space, typography, radius } from '../lib/theme';

const STEPS = [
  {
    title: 'Abra a Central de Contas',
    body: 'No Instagram: seu perfil → menu (☰) → Configurações e privacidade → Central de Contas.',
  },
  {
    title: 'Vá em Suas informações e permissões',
    body: 'Toque em "Baixar suas informações" e depois em "Solicitar um download".',
  },
  {
    title: 'Marque só Seguidores e seguindo',
    body: 'Escolha "Algumas das suas informações" e selecione apenas Seguidores e seguindo. Isso faz o arquivo sair em minutos em vez de horas, e com kilobytes em vez de 100 MB.',
    emphasis: true,
  },
  {
    title: 'Em período, escolha Todo o período',
    body: 'É o passo que mais gente erra. Se você limitar a 12 meses, o arquivo traz só quem começou a te seguir nesse intervalo — e o app passa a achar que todo o resto sumiu.',
    emphasis: true,
  },
  {
    title: 'O formato pode ser JSON ou HTML',
    body: 'Os dois funcionam. Se aparecer a opção, prefira JSON: a data de cada seguidor vem mais precisa. Mas não refaça o pedido só por isso.',
  },
  {
    title: 'Espere o e-mail do Instagram',
    body: 'Pode levar de alguns minutos a 48 horas. Avisamos você quando for hora de tentar de novo.',
  },
  {
    title: 'Volte aqui e envie o arquivo',
    body: 'Baixe o .zip que o Instagram mandar e toque em "Enviar arquivo" abaixo. Ele não sai do seu aparelho.',
  },
];

interface Props {
  onPickFile: () => void;
  onOpenModes: () => void;
  onOpenConta: () => void;
  importing?: boolean;
  /** Fração já lida do zip (0..1). O export completo passa de 400 MB. */
  progress?: number;
  /** Mensagem de falha do último import, se houve. */
  error?: string | null;
}

export function ImportGuideScreen({
  onPickFile,
  onOpenModes,
  onOpenConta,
  importing,
  progress,
  error,
}: Props) {
  // Sem porcentagem enquanto não há o que mostrar: um "0%" parado é pior que
  // nenhum número, porque parece travado.
  const rotulo = importing
    ? progress && progress > 0.01
      ? `Lendo o arquivo… ${Math.round(progress * 100)}%`
      : 'Lendo o arquivo…'
    : 'Enviar arquivo';

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content}>
      <Text style={s.eyebrow}>Primeiro import</Text>
      <Text style={s.title}>Vamos buscar seus dados no Instagram</Text>

      <View style={s.note}>
        <Text style={s.noteTitle}>Por que não pedimos sua senha</Text>
        <Text style={s.noteBody}>
          Entregar sua senha a um app de terceiros é o que faz contas serem bloqueadas.
          O Rastro trabalha com o arquivo que o próprio Instagram entrega a você, então
          sua conta nunca fica exposta. O custo disso são os passos abaixo.
        </Text>
      </View>

      {error ? (
        <View style={[s.note, s.noteError]}>
          <Text style={s.noteTitle}>Não deu para ler esse arquivo</Text>
          <Text style={s.noteBody}>{error}</Text>
        </View>
      ) : null}

      {STEPS.map((step, i) => (
        <View key={step.title} style={s.step}>
          {/* Numeração faz sentido aqui: é um procedimento em ordem obrigatória. */}
          <Text style={s.stepNumber}>{String(i + 1).padStart(2, '0')}</Text>
          <View style={s.stepText}>
            <Text style={[s.stepTitle, step.emphasis && s.stepTitleEmphasis]}>{step.title}</Text>
            <Text style={s.stepBody}>{step.body}</Text>
          </View>
        </View>
      ))}

      <Pressable style={[s.primary, importing && s.primaryDisabled]} onPress={onPickFile} disabled={importing}>
        <Text style={s.primaryLabel}>{rotulo}</Text>
      </Pressable>

      <Pressable onPress={() => Linking.openURL('https://www.instagram.com/download/request/')}>
        <Text style={s.secondaryLabel}>Abrir a página de download do Instagram</Text>
      </Pressable>

      <Pressable onPress={onOpenModes}>
        <Text style={s.secondaryLabel}>Dá para usar sem baixar esse arquivo?</Text>
      </Pressable>

      <Pressable onPress={onOpenConta}>
        <Text style={s.secondaryLabel}>Já usa o Rastro em outro aparelho? Entrar</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  content: { padding: space.lg, paddingBottom: space.xxl, gap: space.md },
  eyebrow: {
    color: colors.gained,
    fontSize: typography.scale.micro,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  title: { color: colors.ink, fontSize: typography.scale.title, marginBottom: space.sm },
  note: {
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: colors.gained,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  noteError: { borderLeftColor: colors.danger },
  noteTitle: { color: colors.ink, fontSize: typography.scale.body },
  noteBody: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 20 },
  step: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm },
  stepNumber: { color: colors.inkFaint, fontSize: typography.scale.caption, width: 24 },
  stepText: { flex: 1, gap: space.xs },
  stepTitle: { color: colors.ink, fontSize: typography.scale.body },
  stepTitleEmphasis: { color: colors.gained },
  stepBody: { color: colors.inkMuted, fontSize: typography.scale.caption, lineHeight: 20 },
  primary: {
    backgroundColor: colors.gained,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
    marginTop: space.md,
  },
  primaryDisabled: { opacity: 0.6 },
  primaryLabel: { color: colors.base, fontSize: typography.scale.body },
  secondaryLabel: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    textAlign: 'center',
    padding: space.md,
  },
});
