/**
 * Caixa fantasma — ler sem marcar como visto, e quem comentou em você.
 *
 * ## O que faz, e por que funciona
 *
 * A documentação da Meta é explícita: *"Webhooks notifications or messages
 * delivered via the API will not be considered as Read in the Instagram app
 * inbox. Only after a reply is sent will a message be considered Read."*
 *
 * Ou seja: ler aqui não acende o "visto" lá. É o pedido do dono, e a premissa
 * técnica se sustenta.
 *
 * ## O que a tela precisa dizer, e diz
 *
 * Três limites que, calados, fazem a tela parecer quebrada:
 *
 * 1. **Só chega o que veio depois de conectar.** A API não tem endpoint de
 *    histórico. Uma caixa vazia é o estado normal de quem acabou de ligar.
 * 2. **Grupo não vem, e conversa que você começou também não** — o webhook
 *    entrega conversa individual iniciada pelo outro lado.
 * 3. **Celular novo não abre o que era do antigo.** A chave privada não sai do
 *    aparelho, e é isso que faz o servidor guardar sem poder ler.
 *
 * ## O que a tela não tem, e não é esquecimento
 *
 * Não há responder, ocultar nem apagar. Os escopos autorizam; a regra 4 do
 * CLAUDE.md não — é a mesma regra que recusou o "deixar de seguir em massa". O
 * app lê a conta do usuário e não age nela.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Banner, EmptyState, SectionTitle } from '../components/ui';
import { IconeEscudo } from '../components/icons';
import { abrirSelo, chaveDoAparelho } from '../lib/cofre';
import {
  lerComentariosSelados,
  lerMensagensSeladas,
  registrarChaveDoCofre,
  type ComentarioSelado,
  type MensagemSelada,
} from '../api/client';
import { colors, heading, radius, space, typography } from '../lib/theme';
import { formatDate, formatRelative } from '../lib/format';

type Aba = 'mensagens' | 'comentarios';

interface MensagemAberta {
  id: string;
  threadId: string;
  fromSelf: boolean;
  at: number;
  /** `null` quando o selo é de uma chave anterior — ver o topo do arquivo. */
  texto: string | null;
}

interface ComentarioAberto {
  id: string;
  at: number;
  fromSelf: boolean;
  texto: string | null;
  username: string | null;
}

interface Props {
  profileId: string | null;
  onCriarConta: () => void;
}

export function CaixaFantasmaScreen({ profileId, onCriarConta }: Props) {
  const [aba, setAba] = useState<Aba>('mensagens');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [chaveNova, setChaveNova] = useState(false);
  const [mensagens, setMensagens] = useState<MensagemAberta[]>([]);
  const [comentarios, setComentarios] = useState<ComentarioAberto[]>([]);

  const carregar = useCallback(async () => {
    if (!profileId) return;
    setCarregando(true);
    setErro(null);
    try {
      /*
       * A chave vem antes de tudo. Sem ela registrada, o servidor descarta o que
       * chega — então este é o passo que liga a funcionalidade, e não um detalhe
       * de inicialização.
       */
      const par = await chaveDoAparelho();
      if (!par) {
        setErro('Este aparelho não tem cofre seguro disponível, então o conteúdo não pode ser guardado.');
        return;
      }
      const { descartouHistorico } = await registrarChaveDoCofre(profileId, par.publicKey);
      setChaveNova(descartouHistorico);

      const [caixa, recebidos] = await Promise.all([
        lerMensagensSeladas(profileId),
        lerComentariosSelados(profileId),
      ]);

      setMensagens(await Promise.all(caixa.messages.map(abrirMensagem)));
      setComentarios(await Promise.all(recebidos.map(abrirComentario)));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para carregar.');
    } finally {
      setCarregando(false);
    }
  }, [profileId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (!profileId) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.conteudo}>
        <Text style={s.titulo}>Ler sem dar visto</Text>
        <Text style={s.explicacao}>
          Mensagens novas e comentários chegam ao Rastro sem passar pelo Instagram, então abrir
          aqui não marca a conversa como vista lá.
        </Text>
        <Text style={s.explicacao}>
          Precisa de uma conta no Rastro: quem recebe o aviso do Instagram é o servidor, com o
          app fechado.
        </Text>
        <Promessa />
        <Pressable onPress={onCriarConta} style={s.botao} accessibilityRole="button">
          <Text style={s.botaoTexto}>Criar conta</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (carregando) {
    return (
      <View style={s.centro}>
        <ActivityIndicator color={colors.gained} />
      </View>
    );
  }

  const lista = aba === 'mensagens' ? mensagens : comentarios;
  const fechados = lista.filter((i) => i.texto === null).length;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.conteudo}>
      <View style={s.abas}>
        <Chip rotulo="Mensagens" ativa={aba === 'mensagens'} onPress={() => setAba('mensagens')} />
        <Chip
          rotulo="Comentários"
          ativa={aba === 'comentarios'}
          onPress={() => setAba('comentarios')}
        />
      </View>

      {erro ? <Banner title="Não deu certo" body={erro} tone="danger" /> : null}

      {chaveNova ? (
        <Banner
          title="Cofre novo neste aparelho"
          body={
            'A chave que abre o conteúdo fica só neste celular. Como ela foi criada agora, o ' +
            'que tinha sido guardado para um aparelho anterior foi apagado — ninguém teria como abrir.'
          }
          tone="warning"
        />
      ) : null}

      {fechados > 0 ? (
        <Banner
          title={`${fechados} ${fechados === 1 ? 'item não abriu' : 'itens não abriram'}`}
          body="Foram guardados para a chave de outro aparelho. Só o celular que os recebeu consegue lê-los."
          tone="info"
        />
      ) : null}

      {aba === 'mensagens' ? (
        <Mensagens itens={mensagens} />
      ) : (
        <Comentarios itens={comentarios} />
      )}

      <Promessa />
    </ScrollView>
  );
}

function Mensagens({ itens }: { itens: MensagemAberta[] }) {
  if (itens.length === 0) {
    return (
      <EmptyState
        title="Nenhuma mensagem ainda"
        body={
          'Só aparecem aqui as mensagens que chegarem a partir de agora — o Instagram não ' +
          'entrega conversas antigas para aplicativos. Conversas em grupo e as que você começou ' +
          'também não vêm.'
        }
      />
    );
  }

  // Agrupadas por conversa, a mais recente primeiro. `threadId` é o id do outro
  // lado no Instagram, não o @: a API não devolve o @ de quem manda mensagem.
  const porConversa = new Map<string, MensagemAberta[]>();
  for (const m of itens) {
    const atual = porConversa.get(m.threadId) ?? [];
    atual.push(m);
    porConversa.set(m.threadId, atual);
  }

  return (
    <>
      <SectionTitle>{`${porConversa.size} ${porConversa.size === 1 ? 'conversa' : 'conversas'}`}</SectionTitle>
      {[...porConversa.values()].map((conversa) => (
        <View key={conversa[0]!.threadId} style={s.conversa}>
          <Text style={s.conversaData}>
            {formatRelative(conversa[0]!.at)} · {formatDate(conversa[0]!.at)}
          </Text>
          {conversa.map((m) => (
            <View key={m.id} style={[s.bolha, m.fromSelf && s.bolhaMinha]}>
              <Text style={s.quem}>{m.fromSelf ? 'Você' : 'Ela(e)'}</Text>
              <Text style={m.texto ? s.mensagem : s.fechado}>
                {m.texto ?? 'guardado para outro aparelho'}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </>
  );
}

function Comentarios({ itens }: { itens: ComentarioAberto[] }) {
  const deOutros = itens.filter((c) => !c.fromSelf);

  if (deOutros.length === 0) {
    return (
      <EmptyState
        title="Nenhum comentário ainda"
        body={
          'Comentários nos seus posts aparecem aqui a partir de agora. É a única parte do app ' +
          'com nome de quem interagiu com você — o arquivo do Instagram só traz os comentários ' +
          'que você fez em posts dos outros.'
        }
      />
    );
  }

  return (
    <>
      <SectionTitle>{`${deOutros.length} ${deOutros.length === 1 ? 'comentário' : 'comentários'}`}</SectionTitle>
      {deOutros.map((c) => (
        <View key={c.id} style={s.comentario}>
          <Text style={s.autor}>{c.username ? `@${c.username}` : 'alguém'}</Text>
          <Text style={c.texto ? s.mensagem : s.fechado}>
            {c.texto ?? 'guardado para outro aparelho'}
          </Text>
          <Text style={s.conversaData}>
            {formatRelative(c.at)} · {formatDate(c.at)}
          </Text>
        </View>
      ))}
    </>
  );
}

function Chip({
  rotulo,
  ativa,
  onPress,
}: {
  rotulo: string;
  ativa: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: ativa }}
      style={[s.chip, ativa && s.chipAtiva]}
    >
      <Text style={[s.chipTexto, ativa && s.chipTextoAtiva]}>{rotulo}</Text>
    </Pressable>
  );
}

function Promessa() {
  return (
    <View style={s.promessa}>
      <IconeEscudo size={20} />
      <Text style={s.promessaTexto}>
        O conteúdo é guardado embaralhado com uma chave que existe só neste celular — nem o
        servidor do Rastro consegue lê-lo. E o app não responde, oculta nem apaga nada: ele lê a
        sua conta, não age nela.
      </Text>
    </View>
  );
}

async function abrirMensagem(m: MensagemSelada): Promise<MensagemAberta> {
  return {
    id: m.id,
    threadId: m.threadId,
    fromSelf: m.fromSelf,
    at: m.at,
    texto: campoDoSelo(await abrirSelo(m.sealed), 'text'),
  };
}

async function abrirComentario(c: ComentarioSelado): Promise<ComentarioAberto> {
  const aberto = await abrirSelo(c.sealed);
  return {
    id: c.id,
    at: c.at,
    fromSelf: c.fromSelf,
    texto: campoDoSelo(aberto, 'text'),
    username: campoDoSelo(aberto, 'username'),
  };
}

/** Um campo do JSON selado, ou `null` se o selo não abriu ou veio diferente. */
function campoDoSelo(aberto: string | null, campo: string): string | null {
  if (aberto === null) return null;
  try {
    const valor = (JSON.parse(aberto) as Record<string, unknown>)[campo];
    return typeof valor === 'string' && valor.length > 0 ? valor : null;
  } catch {
    return null;
  }
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.base },
  conteudo: { padding: space.md, gap: space.sm, paddingBottom: space.xl },

  titulo: { ...heading.title, color: colors.ink },
  explicacao: { fontSize: typography.scale.body, lineHeight: 21, color: colors.inkMuted },

  abas: { flexDirection: 'row', gap: space.sm, marginBottom: space.xs },
  chip: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  chipAtiva: { backgroundColor: colors.gainedSoft },
  chipTexto: { fontSize: typography.scale.caption, color: colors.inkMuted },
  chipTextoAtiva: { color: colors.ink, fontWeight: typography.weight.semibold },

  conversa: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  conversaData: { fontSize: typography.scale.micro, color: colors.inkFaint },
  bolha: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: space.sm,
    gap: 2,
  },
  // A minha fica com o acento à esquerda: numa lista sem avatar, é o que separa
  // "eu escrevi" de "me escreveram" sem depender de ler o rótulo.
  bolhaMinha: { borderLeftWidth: 2, borderLeftColor: colors.gained },
  quem: { fontSize: typography.scale.micro, color: colors.inkFaint },
  mensagem: { fontSize: typography.scale.body, lineHeight: 20, color: colors.ink },
  fechado: { fontSize: typography.scale.caption, color: colors.inkFaint, fontStyle: 'italic' },

  comentario: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.xs,
  },
  autor: {
    fontSize: typography.scale.caption,
    color: colors.gained,
    fontWeight: typography.weight.semibold,
  },

  promessa: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.gainedSoft,
    borderRadius: radius.md,
    padding: space.md,
    marginTop: space.md,
  },
  promessaTexto: {
    flex: 1,
    fontSize: typography.scale.caption,
    lineHeight: 19,
    color: colors.ink,
  },

  botao: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: 'center',
  },
  botaoTexto: { fontSize: typography.scale.body, color: colors.ink },
});
