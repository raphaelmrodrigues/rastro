/**
 * Raiz do app.
 *
 * ## Conta opcional (16/08/2026)
 *
 * O app abre e funciona inteiro sem conta: o import, o diff, as listas e as
 * estatísticas rodam sobre arquivos no próprio aparelho. A conta existe para
 * guardar o histórico fora do celular, trocar de aparelho sem perder nada e,
 * adiante, o plano pago.
 *
 * Entre 14 e 16/08/2026 a conta foi obrigatória e esta raiz bloqueava tudo numa
 * tela de login. A reversão é de produto: exigir cadastro antes de a pessoa ver
 * qualquer resultado punha uma parede no começo de um funil que já obriga a
 * pessoa a sair do app, pedir um arquivo dentro do Instagram e esperar por ele,
 * e nenhuma função do app precisava disso para funcionar.
 *
 * Onde a conta é oferecida agora: num convite depois do import (`ConviteDeConta`)
 * e no Perfil, sempre. Nunca antes de o app ter entregue alguma coisa.
 *
 * Consequência que precisa continuar verdadeira: a senha pedida é a do
 * **Rastro**, nunca a do Instagram, e a tela diz isso antes dos campos. Um
 * formulário de login num app de seguidores é exatamente o que o usuário viu nos
 * apps que queimaram a conta dele.
 *
 * ## A primeira abertura (19/08/2026)
 *
 * Quem abre o app pela primeira vez cai em `BemVindoScreen`, quatro slides que
 * antes eram parágrafos empilhados dentro da tela de importar. Passa uma vez
 * só: o `AJUSTE_BEM_VINDO` marca no disco, e a marca some junto com os dados
 * quando a pessoa apaga tudo — que é o comportamento certo, porque quem apagou
 * tudo está começando de novo.
 *
 * ## Navegação
 *
 * Estado, sem biblioteca de rotas: cinco abas e uma pilha de um nível. Trocar
 * por expo-router quando houver deep link — antes disso a dependência custa mais
 * do que resolve.
 *
 * O "chrome" (cabeçalho e barra de abas) mora aqui e não dentro das telas: assim
 * a barra de abas fica fora da área que rola e não some quando a lista de
 * seguidores é longa.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
} from '@expo-google-fonts/outfit';
import { ArquivoIlegivel, escolherArquivoDoExport } from './lib/arquivo';
import { ArquivoNaoEhZip } from './lib/zip';
import { ImportGuideScreen, type FaseDoImport } from './screens/ImportGuideScreen';
import { BemVindoScreen } from './screens/BemVindoScreen';
import { DashboardScreen, type ListaId } from './screens/DashboardScreen';
import { PessoasScreen } from './screens/PessoasScreen';
import { PeopleListScreen, TITULOS } from './screens/PeopleListScreen';
import { StatsScreen } from './screens/StatsScreen';
import { SobreOArquivoScreen } from './screens/SobreOArquivoScreen';
import { AtividadeScreen } from './screens/AtividadeScreen';
import {
  AtividadeListaScreen,
  TITULOS_ATIVIDADE,
  type ListaDeAtividade,
} from './screens/AtividadeListaScreen';
import { FilaScreen } from './screens/FilaScreen';
import { PerfilScreen } from './screens/PerfilScreen';
import { ConectarInstagramScreen } from './screens/ConectarInstagramScreen';
import { CaixaFantasmaScreen } from './screens/CaixaFantasmaScreen';
import { AuthScreen } from './screens/AuthScreen';
import { AtualizarScreen } from './screens/AtualizarScreen';
import { Header, TabBar, type Aba } from './components/Chrome';
import { Logotipo } from './components/Marca';
import { LimiteDeErro } from './components/LimiteDeErro';
import { ConviteDeConta } from './components/ConviteDeConta';
import { VistoriaDoArquivo } from './components/VistoriaDoArquivo';
import { relatarErro } from './lib/telemetria';
import { lerAjuste, salvarAjuste } from './lib/storage';
import {
  acaoDaLista,
  criarFila,
  lerFila,
  salvarFila,
  TEXTO_DA_ACAO,
  type Fila,
} from './lib/fila';
import type { ExportCheck } from '@rastro/core';
import { useStore } from './lib/store';
import { useConta } from './lib/conta';
import { useBotaoVoltar } from './lib/voltar';
import {
  prepararNotificacoes,
  reagendarLembrete,
  registrarParaAvisos,
} from './lib/notificacoes';
import { colors, layout, space, typography } from './lib/theme';

/** Tela empilhada sobre a aba atual. `null` = a própria aba. */
type Empilhada =
  | { nome: 'lista'; lista: ListaId }
  | { nome: 'stats' }
  | { nome: 'arquivo' }
  | { nome: 'atividade' }
  | { nome: 'atividadeLista'; lista: ListaDeAtividade }
  | { nome: 'entrar'; modo: 'entrar' | 'cadastrar'; motivo?: string }
  | { nome: 'fila' }
  | { nome: 'instagram' }
  | { nome: 'fantasma' }
  | null;

/** Chave do ajuste que marca as boas-vindas como já vistas. */
const AJUSTE_BEM_VINDO = 'bemvindo.visto';

/**
 * Aviso ao usuário. O Alert do react-native-web é um no-op silencioso, e um erro
 * de import que não aparece é pior que um erro feio.
 */
function avisar(titulo: string, mensagem: string): void {
  if (Platform.OS === 'web') globalThis.alert(`${titulo}\n\n${mensagem}`);
  else Alert.alert(titulo, mensagem);
}

/**
 * Título e texto para uma falha de import.
 *
 * As duas causas conhecidas ganham mensagem própria porque têm solução própria:
 * arquivo errado se resolve reenviando o certo, arquivo ilegível se resolve
 * baixando da nuvem para o celular. A genérica é o último recurso, e o pior
 * lugar para cair — foi ela que já culpou um arquivo perfeito uma vez.
 */
function mensagemDeFalha(erro: unknown): [string, string] {
  if (erro instanceof ArquivoNaoEhZip) return ['Arquivo não reconhecido', erro.message];
  if (erro instanceof ArquivoIlegivel) return ['Não deu para abrir o arquivo', erro.message];
  return [
    'Não deu para ler o arquivo',
    'Tente novamente. Se continuar, peça o arquivo ao Instagram de novo.',
  ];
}

/**
 * Moldura de todas as telas.
 *
 * A largura máxima existe para o navegador. Num monitor, sem ela, uma linha de
 * pessoa fica com o @ na borda esquerda e o ícone de link a mil pixels de
 * distância — e a barra de abas vira uma faixa com cinco ícones perdidos. Em
 * celular a tela é sempre mais estreita que o limite, então nada muda lá.
 */
function Raiz({ children }: { children: ReactNode }) {
  return (
    <View style={s.fundo}>
      {/*
       * `SafeAreaView` do react-native-safe-area-context, e nao o do react-native.
       *
       * O do react-native nao faz nada no Android: la ele e uma View comum. O
       * efeito, num Galaxy A51, era a barra de navegacao do sistema ficar por
       * cima do botao de escolher arquivo — a acao principal do app, inalcancavel
       * porque o toque ia para o botao "voltar" do sistema.
       *
       * A borda de baixo entra aqui, na moldura, e nao em cada barra fixa: assim
       * nenhuma tela pode esquecer dela. O preco e a barra de abas nao encostar
       * na borda do vidro, e ele e zero na pratica — o vao tem a cor do fundo.
       */}
      <SafeAreaView style={s.root} edges={['top', 'bottom', 'left', 'right']}>
        {/*
          * Ícones claros na barra de status: o app é escuro desde 20/08/2026, e
          * `style="dark"` desenharia relógio e bateria em preto sobre preto.
          */}
        <StatusBar style="light" />
        {children}
      </SafeAreaView>
    </View>
  );
}

/**
 * Envolve o app inteiro para que nenhum erro de tela vire tela branca.
 *
 * Fora do `App` de propósito: se o limite morasse dentro dele, um erro no
 * próprio `App` — que é onde mora a navegação — passaria por cima do limite e o
 * usuário veria o nada.
 */
export default function Rastro() {
  return (
    <SafeAreaProvider>
      <LimiteDeErro>
        <App />
      </LimiteDeErro>
    </SafeAreaProvider>
  );
}

function App() {
  const [aba, setAba] = useState<Aba>('inicio');
  const [empilhada, setEmpilhada] = useState<Empilhada>(null);
  /*
   * Em que ponto do envio o app está.
   *
   * Era um booleano que só ligava depois de o arquivo já estar escolhido. O
   * problema apareceu no primeiro teste em aparelho: o seletor do Android leva
   * segundos para abrir, e nesse intervalo o botão continuava com o texto
   * normal, sem indicador nenhum — o toque parecia não ter funcionado. Agora a
   * fase começa no toque, e não depois dele.
   */
  const [fase, setFase] = useState<FaseDoImport>('parado');

  /*
   * Se as boas-vindas já foram vistas. `null` enquanto a resposta não chegou do
   * disco — mostrar a tela de importar e depois trocar pelas boas-vindas seria
   * pior do que esperar os poucos milissegundos da leitura.
   */
  const [bemVindoVisto, setBemVindoVisto] = useState<boolean | null>(null);

  /*
   * A fila de faxina em andamento, se houver.
   *
   * Mora aqui e não na tela porque sobrevive à navegação: a pessoa sai da fila,
   * confere uma lista, volta, e o lugar continua guardado. Persistida em disco
   * pelo mesmo motivo — uma fila de 300 contas não se resolve numa sessão.
   */
  const [fila, setFila] = useState<Fila | null>(null);

  /*
   * Nome do zip do último import bem-sucedido, até a pessoa dispensar o aviso.
   * Só o nome — o caminho de um `content://` do Android não é um caminho de
   * sistema que dê para mostrar, e inventar um mandaria a pessoa procurar onde
   * não está.
   */
  const [arquivoParaApagar, setArquivoParaApagar] = useState<string | null>(null);
  /**
   * Resultado da vistoria à espera de ser mostrado.
   *
   * Guardado aqui e não no store porque é estado de tela: o store guarda o
   * import pendente (que é dado), este guarda o fato de o modal estar aberto.
   */
  const [vistoria, setVistoria] = useState<ExportCheck | null>(null);
  /**
   * Nome do arquivo que está na vistoria.
   *
   * Guardado porque o aviso de "pode apagar o zip" precisa dele, e entre a
   * pergunta e a resposta o seletor já fechou — a `fonte` não existe mais.
   */
  const [arquivoEmVistoria, setArquivoEmVistoria] = useState<string | null>(null);

  /*
   * Fonte de display dos títulos.
   *
   * Os arquivos vêm dentro do app, então "carregar" aqui é ler do disco: alguns
   * milissegundos, não uma requisição. Ainda assim vale esperar antes de
   * desenhar — sem isso a primeira tela aparece na fonte do sistema e troca de
   * letra sozinha um quadro depois, que é o efeito que faz um app parecer mal
   * montado.
   */
  const [fontesProntas] = useFonts({
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });
  /*
   * Convite dispensado nesta sessão.
   *
   * Zera a cada import: quem acabou de guardar mais um arquivo tem mais a
   * perder, e o argumento fica mais forte. Insistir na mesma sessão depois de um
   * "agora não" é o que faz o app parecer vendedor.
   */
  const [conviteDispensado, setConviteDispensado] = useState(false);

  const {
    loading,
    importing,
    progress,
    snapshot,
    reports,
    snapshotCount,
    atividade,
    error,
    boot,
    importZip,
    confirmarPendente,
    descartarPendente,
  } = useStore();
  const { conectado, perfil, iniciar, precisaAtualizar, envio } = useConta();

  useEffect(() => {
    void boot();
    void iniciar();
    // Só configura o canal e o comportamento em primeiro plano. Não pede
    // permissão: isso só acontece quando a pessoa liga o lembrete no perfil.
    void prepararNotificacoes();
    void lerAjuste(AJUSTE_BEM_VINDO).then((v) => setBemVindoVisto(v === 'sim'));
    void lerFila().then(setFila);
  }, [boot, iniciar]);

  /*
   * Recarrega o store quando a restauração termina.
   *
   * A restauração grava snapshots no disco por fora do store, e sem isto eles só
   * apareceriam na próxima abertura do app — o pior momento possível, porque a
   * pessoa acabou de entrar na conta num aparelho novo justamente para ver o
   * histórico e continuaria olhando "envie seu primeiro arquivo".
   */
  useEffect(() => {
    if (envio.situacao === 'restaurado' && envio.quantos > 0) void boot();
  }, [envio, boot]);

  /*
   * Registra o aparelho para os avisos do servidor assim que há conta.
   *
   * Não pede permissão: só registra se a pessoa já concedeu antes (ligando o
   * lembrete). Ver `registrarParaAvisos`. Roda a cada entrada na conta porque o
   * token de push do Expo troca sozinho — reinstalação, restauração de backup —
   * e um token velho é um aviso que some sem ninguém notar.
   */
  useEffect(() => {
    if (conectado === true) void registrarParaAvisos();
  }, [conectado]);

  /*
   * Guarda a fila a cada mudança. Escrever a cada conta resolvida é barato — é
   * um JSON de algumas centenas de @ — e é o que faz a fila sobreviver ao app
   * ser fechado no meio, que é o caso normal numa lista longa.
   */
  const mudarFila = useCallback((proxima: Fila) => {
    setFila(proxima);
    void salvarFila(proxima);
  }, []);

  const descartarFila = useCallback(() => {
    setFila(null);
    void salvarFila(null);
    setEmpilhada(null);
  }, []);

  const iniciarFila = useCallback(
    (lista: ListaId, usernames: string[]) => {
      const acao = acaoDaLista(lista);
      if (!acao || usernames.length === 0) return;
      const nova = criarFila(acao, usernames);
      setFila(nova);
      void salvarFila(nova);
      setEmpilhada({ nome: 'fila' });
    },
    [],
  );

  const concluirBemVindo = useCallback(() => {
    setBemVindoVisto(true);
    void salvarAjuste(AJUSTE_BEM_VINDO, 'sim');
  }, []);

  /*
   * Onde cada tela empilhada volta.
   *
   * A pilha tem dois níveis só na Atividade: dela saem cinco listas, e voltar de
   * uma delas para o início — em vez de para a Atividade — faria o usuário
   * refazer o caminho a cada lista que quisesse ver.
   */
  const voltarDe = useCallback((atual: Empilhada): Empilhada => {
    if (atual?.nome === 'atividadeLista') return { nome: 'atividade' };
    return null;
  }, []);

  /*
   * Botão voltar do Android. Precisa ficar aqui em cima, antes de qualquer
   * `return`, porque hook não pode ser condicional — e as telas de carregamento,
   * login e atualização saem por `return` mais abaixo.
   *
   * A raiz devolve `false` de propósito: na tela inicial, voltar fecha o app,
   * que é o que o usuário de Android espera. Nas telas de login e de atualização
   * obrigatória não há para onde voltar, e `false` também é o certo.
   */
  const voltar = useCallback((): boolean => {
    if (empilhada) {
      setEmpilhada(voltarDe(empilhada));
      return true;
    }
    if (aba !== 'inicio') {
      setAba('inicio');
      return true;
    }
    return false;
  }, [empilhada, aba, voltarDe]);

  useBotaoVoltar(voltar);

  /**
   * O que acontece depois de o arquivo entrar no histórico.
   *
   * Vale para os dois caminhos — o import que passou direto e o que passou
   * depois de o usuário confirmar. Separado da escolha do arquivo porque o
   * segundo caminho acontece minutos depois, com o seletor já fechado.
   */
  const concluirImport = useCallback(
    (nomeDoArquivo: string | null) => {
      // O relógio do lembrete parte da última atualização. Sem reancorar aqui,
      // ele tocaria logo depois de a pessoa ter acabado de atualizar.
      void reagendarLembrete(Date.now());
      if (nomeDoArquivo) setArquivoParaApagar(nomeDoArquivo);
      setConviteDispensado(false);
      setEmpilhada(null);
      setAba('inicio');
    },
    [],
  );

  /** "Conferi, pode guardar": grava o que estava esperando e segue o fluxo normal. */
  const responderVistoria = useCallback(async () => {
    setVistoria(null);
    const { ok, message } = await confirmarPendente();
    if (!ok) {
      avisar('Não deu para guardar', message ?? 'Tente importar de novo.');
      return;
    }
    concluirImport(arquivoEmVistoria);
    setArquivoEmVistoria(null);
  }, [confirmarPendente, concluirImport, arquivoEmVistoria]);

  /*
   * Fechar sem confirmar joga o import fora, e é o certo: o arquivo não entrou
   * no histórico, e deixá-lo pendurado em memória faria o próximo "confirmar" —
   * vindo de outro arquivo — gravar o antigo.
   */
  const fecharVistoria = useCallback(() => {
    setVistoria(null);
    setArquivoEmVistoria(null);
    descartarPendente();
  }, [descartarPendente]);

  /*
   * Escolher e importar.
   *
   * O `try` abraça a escolha do arquivo também, e isso é o conserto de um bug de
   * verdade: até 19/08/2026 a chamada ao seletor ficava fora dele. Quando ela
   * falhava no aparelho — e falhava, porque copiava 479 MB antes de devolver — a
   * exceção virava uma rejeição de promessa que ninguém pegava. Em produção isso
   * não imprime nada e não mostra nada: o usuário escolhia o arquivo e a tela
   * simplesmente não reagia.
   */
  const escolherArquivo = async () => {
    // Toque duplo enquanto o seletor abre chamaria o picker duas vezes, e no
    // Android a segunda chamada deixa a primeira pendurada para sempre.
    if (fase !== 'parado') return;

    setFase('escolhendo');
    try {
      // O callback só dispara no caminho lento, quando o aparelho obriga a
      // copiar o arquivo antes de conseguir lê-lo. Ver lib/arquivo.ts.
      const fonte = await escolherArquivoDoExport(() => setFase('preparando'));
      if (!fonte) return;

      setFase('lendo');
      const { ok, message, check, precisaConfirmar } = await importZip(fonte);

      /*
       * Três desfechos, e a ordem importa.
       *
       * Vistoria vem antes da mensagem de falha porque ela é mais específica:
       * "este export cobre só 12 meses" resolve o problema, "não deu para ler"
       * manda a pessoa tentar de novo com o mesmo arquivo errado.
       */
      if (check && (!ok || precisaConfirmar)) {
        setArquivoEmVistoria(fonte.nome);
        setVistoria(check);
        return;
      }
      if (!ok) {
        avisar('Não deu para ler', message ?? 'Tente novamente.');
        return;
      }

      concluirImport(fonte.nome);
    } catch (erro) {
      /*
       * Relata antes de avisar. Esta é a falha que só aparece em aparelho de
       * verdade, com arquivo de verdade — exatamente a que não dá para reproduzir
       * no navegador do desenvolvedor, e a que o painel precisa mostrar.
       */
      relatarErro(erro, 'import');
      avisar(...mensagemDeFalha(erro));
    } finally {
      setFase('parado');
    }
  };

  /*
   * Corte de versão vem antes de tudo, inclusive do carregamento e do login:
   * se o servidor desligou esta versão, nenhuma outra tela tem o que fazer, e
   * mostrar a de login primeiro só produziria um erro no meio da tentativa.
   */
  if (precisaAtualizar) {
    return (
      <Raiz>
        <AtualizarScreen />
      </Raiz>
    );
  }

  /*
   * Espera só os dados locais, e não a sessão.
   *
   * A restauração de sessão depende de rede; prender a abertura do app nela faria
   * quem está sem sinal olhar para a marca até o tempo limite estourar — para
   * chegar num app que funciona offline de qualquer jeito.
   */
  if (loading || bemVindoVisto === null || !fontesProntas) {
    return (
      <Raiz>
        <View style={s.centro}>
          <Logotipo size="grande" />
          <ActivityIndicator color={colors.gained} />
        </View>
      </Raiz>
    );
  }

  const tituloEmpilhada =
    empilhada?.nome === 'lista'
      ? TITULOS[empilhada.lista].title
      : empilhada?.nome === 'stats'
        ? 'Evolução'
        : empilhada?.nome === 'arquivo'
          ? 'Sobre o arquivo'
          : empilhada?.nome === 'atividade'
            ? 'Conversas e atividade'
            : empilhada?.nome === 'atividadeLista'
              ? TITULOS_ATIVIDADE[empilhada.lista].title
              : empilhada?.nome === 'entrar'
                ? empilhada.modo === 'cadastrar'
                  ? 'Criar conta'
                  : 'Entrar'
                : empilhada?.nome === 'fila' && fila
                  ? TEXTO_DA_ACAO[fila.acao].titulo
                  : empilhada?.nome === 'instagram'
                    ? 'Modo conectado'
                    : empilhada?.nome === 'fantasma'
                      ? 'Caixa fantasma'
                      : undefined;

  const semDados = !snapshot || !reports;
  // O store liga `importing` por conta própria; a fase local cobre o trecho
  // anterior, que ele não vê. Quem manda é a mais adiantada das duas.
  const faseDoImport: FaseDoImport = fase !== 'parado' ? fase : importing ? 'lendo' : 'parado';

  // Sem nenhum arquivo ainda, o app tem uma coisa só a oferecer. Mostrar abas
  // vazias seria dar cinco caminhos que não levam a lugar nenhum.
  if (semDados) {
    /*
     * Boas-vindas, uma vez na vida do app.
     *
     * Antes de qualquer outra coisa deste bloco: sem arquivo nenhum e sem nunca
     * ter visto a apresentação, não há o que o cabeçalho, as abas ou o perfil
     * tenham a dizer que valha interromper os quatro slides.
     */
    if (!bemVindoVisto) {
      return (
        <Raiz>
          <BemVindoScreen aoConcluir={concluirBemVindo} />
        </Raiz>
      );
    }

    /*
     * A ordem aqui importa e já causou bug: a versão anterior testava
     * `aba === 'perfil'` antes da tela empilhada. Abrir "Sobre o arquivo" a
     * partir do perfil marcava o estado mas não trocava a tela — parecia um
     * toque ignorado —, e a tela ficava pendurada até a próxima troca de aba,
     * quando aparecia no lugar errado. A tela empilhada vem sempre primeiro,
     * como no bloco de baixo.
     */
    const noArquivo = empilhada?.nome === 'arquivo';
    const naEntrada = empilhada?.nome === 'entrar';
    const noInstagram = empilhada?.nome === 'instagram';
    const naFantasma = empilhada?.nome === 'fantasma';
    const noPerfil = aba === 'perfil';

    return (
      <Raiz>
        {naEntrada ? (
          <Header titulo={tituloEmpilhada} onVoltar={() => setEmpilhada(null)} />
        ) : noArquivo || noInstagram || naFantasma || noPerfil ? (
          <Header
            titulo={
              noArquivo
                ? 'Sobre o arquivo'
                : noInstagram
                  ? 'Modo conectado'
                  : naFantasma
                    ? 'Caixa fantasma'
                    : 'Perfil'
            }
            // Sem barra de abas nesta fase, o cabeçalho é a única saída.
            onVoltar={
              noArquivo || noInstagram || naFantasma
                ? () => setEmpilhada(null)
                : () => setAba('importar')
            }
          />
        ) : (
          <Header acao={<AtalhoPerfil onPress={() => setAba('perfil')} />} />
        )}

        {naEntrada ? (
          <AuthScreen
            modoInicial={empilhada.modo}
            {...(empilhada.motivo ? { motivo: empilhada.motivo } : {})}
            aoConcluir={() => setEmpilhada(null)}
          />
        ) : noArquivo ? (
          <SobreOArquivoScreen />
        ) : noInstagram ? (
          <ConectarInstagramScreen
            profileId={perfil?.id ?? null}
            onCriarConta={() =>
              setEmpilhada({
                nome: 'entrar',
                modo: 'cadastrar',
                motivo: 'A coleta diária roda no servidor, com o app fechado.',
              })
            }
          />
        ) : naFantasma ? (
          <CaixaFantasmaScreen
            profileId={perfil?.id ?? null}
            onCriarConta={() =>
              setEmpilhada({
                nome: 'entrar',
                modo: 'cadastrar',
                motivo: 'O Instagram avisa o servidor, com o app fechado.',
              })
            }
          />
        ) : noPerfil ? (
          <PerfilScreen
            snapshotCount={snapshotCount}
            ultimaAtualizacao={snapshot?.importedAt ?? null}
            onImportar={() => setAba('importar')}
            onAbrirSobreArquivo={() => setEmpilhada({ nome: 'arquivo' })}
            onCriarConta={() => setEmpilhada({ nome: 'entrar', modo: 'cadastrar' })}
            onEntrar={() => setEmpilhada({ nome: 'entrar', modo: 'entrar' })}
            onAbrirModoConectado={() => setEmpilhada({ nome: 'instagram' })}
            onAbrirCaixaFantasma={() => setEmpilhada({ nome: 'fantasma' })}
          />
        ) : (
          <ImportGuideScreen
            primeiraVez
            onPickFile={escolherArquivo}
            onAbrirSobreArquivo={() => setEmpilhada({ nome: 'arquivo' })}
            fase={faseDoImport}
            progress={progress}
            error={error}
          />
        )}

      <VistoriaDoArquivo
        check={vistoria}
        onConfirmar={() => void responderVistoria()}
        onDescartar={fecharVistoria}
        onVerComoPedir={() => {
          fecharVistoria();
          setEmpilhada(null);
          setAba('importar');
        }}
      />
    </Raiz>
    );
  }

  return (
    <Raiz>
      {empilhada ? (
        <Header titulo={tituloEmpilhada} onVoltar={() => setEmpilhada(voltarDe(empilhada))} />
      ) : (
        <Header acao={<AtalhoPerfil onPress={() => setAba('perfil')} />} />
      )}

      <View style={s.corpo}>
        {empilhada?.nome === 'entrar' ? (
          <AuthScreen
            modoInicial={empilhada.modo}
            {...(empilhada.motivo ? { motivo: empilhada.motivo } : {})}
            aoConcluir={() => setEmpilhada(null)}
          />
        ) : empilhada?.nome === 'fila' && fila ? (
          <FilaScreen
            fila={fila}
            onMudar={mudarFila}
            onSair={() => setEmpilhada(null)}
            onDescartar={descartarFila}
          />
        ) : empilhada?.nome === 'lista' ? (
          <PeopleListScreen
            lista={empilhada.lista}
            insights={reports.insights}
            diff={reports.diff}
            snapshot={snapshot}
            onIniciarFila={(usernames) => iniciarFila(empilhada.lista, usernames)}
          />
        ) : empilhada?.nome === 'stats' ? (
          <StatsScreen reports={reports} snapshotCount={snapshotCount} />
        ) : empilhada?.nome === 'arquivo' ? (
          <SobreOArquivoScreen />
        ) : empilhada?.nome === 'instagram' ? (
          <ConectarInstagramScreen
            profileId={perfil?.id ?? null}
            onCriarConta={() =>
              setEmpilhada({
                nome: 'entrar',
                modo: 'cadastrar',
                motivo: 'A coleta diária roda no servidor, com o app fechado.',
              })
            }
          />
        ) : empilhada?.nome === 'fantasma' ? (
          <CaixaFantasmaScreen
            profileId={perfil?.id ?? null}
            onCriarConta={() =>
              setEmpilhada({
                nome: 'entrar',
                modo: 'cadastrar',
                motivo: 'O Instagram avisa o servidor, com o app fechado.',
              })
            }
          />
        ) : empilhada?.nome === 'atividade' ? (
          <AtividadeScreen
            atividade={atividade}
            onAbrir={(lista) => setEmpilhada({ nome: 'atividadeLista', lista })}
            onComoConseguir={() => setEmpilhada({ nome: 'arquivo' })}
          />
        ) : empilhada?.nome === 'atividadeLista' ? (
          // `atividade` não pode ser null aqui: a lista só é alcançável a partir
          // da tela de atividade, que só mostra os atalhos quando há dados.
          atividade ? (
            <AtividadeListaScreen lista={empilhada.lista} atividade={atividade} />
          ) : null
        ) : aba === 'inicio' ? (
          <DashboardScreen
            snapshot={snapshot}
            reports={reports}
            handle={perfil?.handle ?? null}
            onOpenList={(lista) => setEmpilhada({ nome: 'lista', lista })}
            onOpenStats={() => setEmpilhada({ nome: 'stats' })}
            onImportAgain={() => setAba('importar')}
            onOpenAtividade={() => setEmpilhada({ nome: 'atividade' })}
            conversasPendentes={
              atividade ? atividade.conversations.filter((c) => c.awaitingYou).length : null
            }
            {...(arquivoParaApagar
              ? {
                  arquivoParaApagar: {
                    nome: arquivoParaApagar,
                    onDispensar: () => setArquivoParaApagar(null),
                  },
                }
              : {})}
            {...(fila && fila.pendentes.length > 0
              ? {
                  fila: {
                    restantes: fila.pendentes.length,
                    titulo: TEXTO_DA_ACAO[fila.acao].titulo,
                    onAbrir: () => setEmpilhada({ nome: 'fila' }),
                  },
                }
              : {})}
            convite={
              /*
               * O convite só existe para quem não tem conta, e só depois do
               * import — que é o momento em que a pessoa acabou de ver a própria
               * rede na tela e passa a ter algo concreto a perder.
               */
              conectado === true || conviteDispensado ? null : (
                <ConviteDeConta
                  snapshotCount={snapshotCount}
                  onCriarConta={() =>
                    setEmpilhada({
                      nome: 'entrar',
                      modo: 'cadastrar',
                      motivo: 'Guarde seu histórico fora deste celular.',
                    })
                  }
                  onEntrar={() => setEmpilhada({ nome: 'entrar', modo: 'entrar' })}
                  onDispensar={() => setConviteDispensado(true)}
                />
              )
            }
          />
        ) : aba === 'pessoas' ? (
          <PessoasScreen
            reports={reports}
            snapshot={snapshot}
            onOpenList={(lista) => setEmpilhada({ nome: 'lista', lista })}
            onOpenAtividade={() => setEmpilhada({ nome: 'atividade' })}
            conversasPendentes={
              atividade ? atividade.conversations.filter((c) => c.awaitingYou).length : null
            }
          />
        ) : aba === 'importar' ? (
          <ImportGuideScreen
            primeiraVez={false}
            onPickFile={escolherArquivo}
            onAbrirSobreArquivo={() => setEmpilhada({ nome: 'arquivo' })}
            fase={faseDoImport}
            progress={progress}
            error={error}
          />
        ) : aba === 'evolucao' ? (
          <StatsScreen reports={reports} snapshotCount={snapshotCount} />
        ) : (
          <PerfilScreen
            snapshotCount={snapshotCount}
            ultimaAtualizacao={snapshot.importedAt}
            onImportar={() => setAba('importar')}
            onAbrirSobreArquivo={() => setEmpilhada({ nome: 'arquivo' })}
            onCriarConta={() => setEmpilhada({ nome: 'entrar', modo: 'cadastrar' })}
            onEntrar={() => setEmpilhada({ nome: 'entrar', modo: 'entrar' })}
            onAbrirModoConectado={() => setEmpilhada({ nome: 'instagram' })}
            onAbrirCaixaFantasma={() => setEmpilhada({ nome: 'fantasma' })}
          />
        )}
      </View>

      <TabBar
        ativa={aba}
        aoTrocar={(nova) => {
          // Trocar de aba fecha a tela empilhada: sem isto, voltar para "Início"
          // ainda mostraria a lista aberta antes e o toque pareceria ignorado.
          setEmpilhada(null);
          setAba(nova);
        }}
      />

      <VistoriaDoArquivo
        check={vistoria}
        onConfirmar={() => void responderVistoria()}
        onDescartar={fecharVistoria}
        onVerComoPedir={() => {
          fecharVistoria();
          setEmpilhada(null);
          setAba('importar');
        }}
      />
    </Raiz>
  );
}

/** Atalho para o perfil no canto do cabeçalho, como em qualquer app de rede. */
function AtalhoPerfil({ onPress }: { onPress: () => void }) {
  const perfil = useConta((c) => c.perfil);
  return (
    <Text onPress={onPress} style={s.atalhoPerfil} accessibilityRole="button">
      {perfil ? `@${perfil.handle}` : 'Perfil'}
    </Text>
  );
}

const s = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: colors.base, alignItems: 'center' },
  root: { flex: 1, width: '100%', maxWidth: layout.maxWidth, backgroundColor: colors.base },
  corpo: { flex: 1 },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  atalhoPerfil: {
    color: colors.inkMuted,
    fontSize: typography.scale.caption,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
  },
});
