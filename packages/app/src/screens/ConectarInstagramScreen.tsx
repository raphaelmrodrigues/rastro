/**
 * Modo conectado — a API oficial do Instagram, dentro do app.
 *
 * ## O que esta tela pode prometer, e o que ela nunca vai poder
 *
 * Conectada, a conta responde sozinha **quantos** seguidores você tem, **quantos**
 * entraram e **quantos** saíram por dia, e de onde é o seu público. Sem esperar
 * arquivo, sem importar nada.
 *
 * Ela nunca vai responder **quem**. A API oficial da Meta não expõe a lista de
 * seguidores para nenhum aplicativo de terceiro — não é limitação nossa, nem
 * coisa que uma versão futura resolva. Quem "resolve" isso troca a API oficial
 * por login programático e API privada, e o preço é o banimento da conta do
 * usuário, não da nossa. É a regra 2 do CLAUDE.md.
 *
 * Por isso o texto desta tela repete a limitação em três lugares diferentes:
 * antes de conectar, depois de conectar, e ao lado do número. Um app que insinua
 * "conecte e descubra quem te deixou" é o app que a pessoa desinstala com raiva
 * no dia seguinte — e é exatamente o que a concorrência que pede senha faz.
 *
 * ## Por que não há deep link de volta
 *
 * A autorização acontece na tela do próprio Instagram, e o redirect de volta cai
 * no NOSSO servidor (`/instagram/callback`), que é onde o `code` vira token. O
 * app não participa dessa volta. Então ele faz o que dá: abre o navegador, e
 * reconfere as métricas quando volta ao primeiro plano. Um deep link exigiria
 * esquema próprio registrado na Meta e não mudaria nada para quem usa.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CONNECTED_MODE_REQUIREMENTS, summarizeSeries } from '@rastro/core';
import { Banner, Button, SectionTitle, StatRow } from '../components/ui';
import { IconeEscudo } from '../components/icons';
import {
  desconectarInstagram,
  iniciarConexaoInstagram,
  lerMetricasDoInstagram,
  lerModos,
  sincronizarInstagram,
  type MetricasDoInstagram,
} from '../api/client';
import { colors, heading, radius, space, typography } from '../lib/theme';
import { formatNumber, formatRelative } from '../lib/format';

/** Quantos dias de série a tela mostra. Além disso vira parede de números. */
const DIAS_NA_TELA = 14;

interface Props {
  /** `null` quando a pessoa ainda não tem conta no Rastro. */
  profileId: string | null;
  onCriarConta: () => void;
}

type Estado =
  | { fase: 'carregando' }
  | { fase: 'indisponivel'; motivo: string }
  | { fase: 'desconectado' }
  | { fase: 'conectado'; metricas: MetricasDoInstagram };

export function ConectarInstagramScreen({ profileId, onCriarConta }: Props) {
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** Ligado depois de abrirmos o navegador; some assim que a conexão aparece. */
  const [esperandoVolta, setEsperandoVolta] = useState(false);

  const conferir = useCallback(async () => {
    if (!profileId) return;
    try {
      const modos = await lerModos();
      if (!modos.connectedMode.available) {
        setEstado({
          fase: 'indisponivel',
          motivo:
            'O modo conectado ainda não está ligado neste servidor. Ele chega numa ' +
            'próxima atualização — nada do que você já usa depende dele.',
        });
        return;
      }
      const metricas = await lerMetricasDoInstagram(profileId);
      setEstado(metricas ? { fase: 'conectado', metricas } : { fase: 'desconectado' });
      if (metricas) setEsperandoVolta(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para falar com o servidor.');
      setEstado({ fase: 'desconectado' });
    }
  }, [profileId]);

  useEffect(() => {
    void conferir();
  }, [conferir]);

  /*
   * Reconfere quando o app volta ao primeiro plano.
   *
   * É o substituto do deep link: a pessoa autoriza no navegador, volta para cá,
   * e a tela já está atualizada quando ela olha. Sem isto, sobraria um botão
   * "já autorizei" que é trabalho que o app pode fazer sozinho.
   */
  useEffect(() => {
    if (!esperandoVolta) return;
    const inscricao = AppState.addEventListener('change', (estadoDoApp) => {
      if (estadoDoApp === 'active') void conferir();
    });
    return () => inscricao.remove();
  }, [esperandoVolta, conferir]);

  const conectar = async () => {
    if (!profileId) return;
    setOcupado(true);
    setErro(null);
    try {
      const url = await iniciarConexaoInstagram(profileId);
      setEsperandoVolta(true);
      await Linking.openURL(url);
    } catch (e) {
      setEsperandoVolta(false);
      setErro(e instanceof Error ? e.message : 'Não deu para abrir a autorização.');
    } finally {
      setOcupado(false);
    }
  };

  const atualizarAgora = async () => {
    if (!profileId) return;
    setOcupado(true);
    setErro(null);
    try {
      await sincronizarInstagram(profileId);
      await conferir();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para atualizar agora.');
    } finally {
      setOcupado(false);
    }
  };

  const desconectar = async () => {
    if (!profileId) return;
    setOcupado(true);
    setErro(null);
    try {
      await desconectarInstagram(profileId);
      setEstado({ fase: 'desconectado' });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para desconectar.');
    } finally {
      setOcupado(false);
    }
  };

  /*
   * Sem conta no Rastro não há onde guardar a série.
   *
   * A coleta é diária e roda no servidor, com o app fechado — é o que faz o
   * modo conectado valer alguma coisa. Guardá-la só no aparelho significaria
   * coletar apenas quando o app estivesse aberto, que é quase nunca.
   */
  if (!profileId) {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.conteudo}>
        <Text style={s.titulo}>Acompanhar sem esperar arquivo</Text>
        <Text style={s.explicacao}>
          Dá para o Rastro perguntar ao Instagram, todo dia, quantos seguidores você tem — pela
          API oficial, com você autorizando na tela do próprio Instagram.
        </Text>
        <Text style={s.explicacao}>
          Para isso é preciso ter uma conta no Rastro: quem coleta todo dia é o servidor, com o
          app fechado, e a série precisa de um lugar para morar.
        </Text>
        <Limitacao />
        <Button label="Criar conta" onPress={onCriarConta} />
      </ScrollView>
    );
  }

  if (estado.fase === 'carregando') {
    return (
      <View style={s.centro}>
        <ActivityIndicator color={colors.gained} />
      </View>
    );
  }

  if (estado.fase === 'indisponivel') {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.conteudo}>
        <Text style={s.titulo}>Ainda não disponível</Text>
        <Text style={s.explicacao}>{estado.motivo}</Text>
      </ScrollView>
    );
  }

  if (estado.fase === 'desconectado') {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.conteudo}>
        <Text style={s.titulo}>Conectar ao Instagram</Text>
        <Text style={s.explicacao}>
          Você autoriza na tela do próprio Instagram e o Rastro passa a perguntar, todo dia,
          quantos seguidores você tem. Nada de senha aqui: o acesso é um consentimento que
          você revoga quando quiser, nas configurações da sua conta.
        </Text>

        <Limitacao />

        <SectionTitle>O que a conta precisa ter</SectionTitle>
        {CONNECTED_MODE_REQUIREMENTS.map((r) => (
          <Text key={r} style={s.requisito}>
            • {r}
          </Text>
        ))}

        {erro ? <Banner title="Não deu certo" body={erro} tone="danger" /> : null}
        {esperandoVolta ? (
          <Banner
            title="Esperando sua autorização"
            body="Termine na tela do Instagram e volte para cá. A tela se atualiza sozinha."
            tone="info"
          />
        ) : null}

        <Button
          label={ocupado ? 'Abrindo…' : 'Conectar com o Instagram'}
          onPress={() => void conectar()}
          disabled={ocupado}
        />
        <Text style={s.rodapeNota}>
          O import do arquivo continua sendo o único caminho para saber quem entrou e quem saiu.
          Conectar não substitui, soma.
        </Text>
      </ScrollView>
    );
  }

  const { account, series, activity } = estado.metricas;
  const resumo = summarizeSeries(series);
  const ultimos = series.slice(-DIAS_NA_TELA);
  const atividadeRecente = activity.slice(-DIAS_NA_TELA);
  const entradas = atividadeRecente.reduce((t, d) => t + d.follows, 0);
  const saidas = atividadeRecente.reduce((t, d) => t + d.unfollows, 0);

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.conteudo}>
      <Text style={s.titulo}>@{account.username}</Text>
      <Text style={s.explicacao}>
        {account.lastSyncAt
          ? `Última leitura ${formatRelative(account.lastSyncAt)}.`
          : 'Ainda sem leitura. Toque em atualizar.'}
      </Text>

      {account.lastError ? (
        <Banner
          title="A última coleta falhou"
          body={`${account.lastError} Se persistir, desconecte e conecte de novo.`}
          tone="warning"
        />
      ) : null}
      {erro ? <Banner title="Não deu certo" body={erro} tone="danger" /> : null}

      <SectionTitle>Agora</SectionTitle>
      <StatRow
        itens={[
          {
            label: 'Seguidores',
            value: formatNumber(series[series.length - 1]?.followerCount ?? 0),
          },
          ...(resumo
            ? [
                {
                  label: `desde ${resumo.from}`,
                  value: `${resumo.net > 0 ? '+' : ''}${formatNumber(resumo.net)}`,
                  tone: resumo.net < 0 ? ('lost' as const) : ('gained' as const),
                },
              ]
            : []),
        ]}
      />

      {atividadeRecente.length > 0 ? (
        <>
          <SectionTitle>Últimos {DIAS_NA_TELA} dias</SectionTitle>
          <StatRow
            itens={[
              { label: 'começaram a seguir', value: formatNumber(entradas), tone: 'gained' },
              { label: 'deixaram de seguir', value: formatNumber(saidas), tone: 'lost' },
            ]}
          />
          {/*
           * A frase abaixo é obrigatória ao lado deste número, e não é
           * formalidade. "Deixaram de seguir: 12" ao lado de uma lista de nomes
           * noutra tela do mesmo app é um convite a achar que os nomes são
           * daquelas 12 pessoas. Não são, e nunca vão poder ser.
           */}
          <Text style={s.nota}>
            Estes números não vêm com nomes. A API do Instagram informa quantos entraram e
            saíram, nunca quem — para isso continua sendo o arquivo.
          </Text>
        </>
      ) : (
        <Text style={s.nota}>
          A métrica de entradas e saídas só é liberada para contas profissionais com 100
          seguidores ou mais. A contagem acima funciona de qualquer jeito.
        </Text>
      )}

      {ultimos.length > 1 ? (
        <>
          <SectionTitle>Dia a dia</SectionTitle>
          {[...ultimos].reverse().map((ponto) => (
            <View key={ponto.day} style={s.linhaDia}>
              <Text style={s.dia}>{ponto.day}</Text>
              <Text style={s.contagem}>{formatNumber(ponto.followerCount)}</Text>
              <Text
                style={[
                  s.variacao,
                  ponto.netChange !== null && ponto.netChange > 0 && { color: colors.gained },
                  ponto.netChange !== null && ponto.netChange < 0 && { color: colors.lost },
                ]}
              >
                {ponto.netChange === null
                  ? '—'
                  : `${ponto.netChange > 0 ? '+' : ''}${ponto.netChange}`}
              </Text>
            </View>
          ))}
          {/* Buraco na coleta não pode virar um "dia" no gráfico. Ver DailyFollowerPoint. */}
          {ultimos.some((p) => p.gapDays > 1) ? (
            <Text style={s.nota}>
              Alguns dias ficaram sem leitura. Onde isso aconteceu, a variação mostrada é a
              soma do intervalo inteiro, não de um dia.
            </Text>
          ) : null}
        </>
      ) : null}

      <SectionTitle>Conexão</SectionTitle>
      <Button
        label={ocupado ? 'Atualizando…' : 'Atualizar agora'}
        onPress={() => void atualizarAgora()}
        disabled={ocupado}
      />
      <Button
        label="Desconectar"
        variant="ghost"
        onPress={() => void desconectar()}
        disabled={ocupado}
      />
      <Text style={s.rodapeNota}>
        Desconectar apaga o acesso do nosso servidor. Os números já coletados continuam aqui.
      </Text>
    </ScrollView>
  );
}

/** A frase que não pode sumir de nenhum estado desta tela. */
function Limitacao() {
  return (
    <View style={s.promessa}>
      <IconeEscudo size={20} />
      <Text style={s.promessaTexto}>
        O modo conectado diz <Text style={s.enfase}>quantos</Text> entraram e saíram, nunca{' '}
        <Text style={s.enfase}>quem</Text>. A lista com nomes só existe no arquivo de export —
        a API oficial do Instagram não a fornece a nenhum aplicativo.
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.base },
  conteudo: { padding: space.md, gap: space.sm, paddingBottom: space.xl },

  titulo: { ...heading.title, color: colors.ink },
  explicacao: {
    fontSize: typography.scale.body,
    lineHeight: 21,
    color: colors.inkMuted,
  },
  requisito: {
    fontSize: typography.scale.caption,
    lineHeight: 19,
    color: colors.inkMuted,
  },
  nota: {
    fontSize: typography.scale.caption,
    lineHeight: 19,
    color: colors.inkFaint,
    marginTop: space.xs,
  },
  rodapeNota: {
    fontSize: typography.scale.micro,
    lineHeight: 17,
    color: colors.inkFaint,
    marginTop: space.sm,
  },

  promessa: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.gainedSoft,
    borderRadius: radius.md,
    padding: space.md,
  },
  promessaTexto: {
    flex: 1,
    fontSize: typography.scale.caption,
    lineHeight: 19,
    color: colors.ink,
  },
  enfase: { fontWeight: typography.weight.bold },

  linhaDia: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  dia: { flex: 1, fontSize: typography.scale.caption, color: colors.inkMuted },
  contagem: {
    width: 80,
    textAlign: 'right',
    fontSize: typography.scale.body,
    color: colors.ink,
  },
  variacao: {
    width: 64,
    textAlign: 'right',
    fontSize: typography.scale.caption,
    color: colors.inkFaint,
  },
});
