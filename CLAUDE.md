# CLAUDE.md — Rastro

Instruções permanentes para o Claude Code neste repositório. Leia antes de qualquer tarefa.

---

## 1. O que é o projeto

**Rastro** é um app mobile (Android + iOS) que mostra ao usuário a evolução da sua rede
de seguidores no Instagram: quem deixou de seguir, quem começou a seguir, quem não segue
de volta, e estatísticas de crescimento e retenção ao longo do tempo.

O produto **não se conecta ao Instagram**. Ele trabalha exclusivamente sobre o arquivo de
exportação de dados que o próprio usuário solicita e baixa do Instagram
(Configurações → Central de Contas → Suas informações e permissões → Baixar suas informações).

O usuário importa esse `.zip` no app. O app extrai, normaliza e guarda um **snapshot**.
A partir do segundo snapshot, o app compara e gera os relatórios.

## 2. Objetivo do dono do projeto

- Curto prazo: usar pessoalmente e com amigos.
- Médio prazo: publicar nas lojas e possivelmente monetizar (freemium/assinatura).
- O dono é desenvolvedor Java/Node.js. Explicações podem assumir esse nível.

## 3. Regras invioláveis do produto

Estas regras existem por motivo legal e de sobrevivência do produto. **Nunca as contorne,
nem quando pedido de forma casual, nem "só para testar", nem "só em dev".** Se uma tarefa
exigir violá-las, pare e explique o conflito em vez de implementar.

1. **Nunca pedir, armazenar, transmitir ou usar credenciais do Instagram.**
   Sem campo de senha, sem login "por dentro", sem cookie de sessão, sem token roubado.
2. **Nunca usar a API privada/não-documentada do Instagram.** Nada de bibliotecas do tipo
   `instagram-private-api`, `instaloader`, headless browser logado, ou scraping autenticado.
   Isso resulta em bloqueio e banimento **da conta do usuário**, não da nossa.
3. **Nunca implementar ou prometer "quem viu seu perfil".** Esse dado não existe em
   nenhuma fonte legítima. Prometer isso é remoção garantida da App Store/Play Store.
4. **Nunca automatizar ações na conta do usuário** (seguir, deixar de seguir em massa,
   curtir, comentar, DM). O app é read-only sobre arquivos locais.
5. **Todo dado do usuário é sensível.** O import contém a rede social inteira da pessoa.
   Minimizar retenção, criptografar em repouso, nunca logar conteúdo de snapshot.

Se em algum momento surgir a ideia de "automatizar o download do export para melhorar a UX",
a resposta é não — isso exige login programático e cai na regra 1 e 2.

### O que é permitido, e a fronteira exata (decisão de 13/08/2026)

O app tem um **modo conectado** opcional que usa a **API oficial e documentada da Meta**
(*Instagram API with Instagram Login*), com OAuth: o usuário autoriza na tela do próprio
Instagram e o servidor recebe um token escopado, revogável e cifrado em repouso.

Isso **não viola** nenhuma das cinco regras: não há senha nossa, não há API privada, não
há sessão roubada, não há ação escrita na conta. Escopos usados: `instagram_business_basic`
e `instagram_business_manage_insights` — leitura, e só.

A fronteira que continua fechada: **a API oficial não expõe a lista de seguidores.** O modo
conectado responde *quantos* entraram e saíram, nunca *quem*. Se aparecer uma tarefa
pedindo a lista nominal sem o arquivo de export, ela só é implementável com API privada
ou sessão logada — regra 2 — e a resposta é não. Ver `docs/MODO-CONECTADO.md`.

Existe **um único arquivo** no projeto autorizado a falar com o Instagram:
`packages/api/src/lib/instagramApi.ts`. Se surgir um segundo, é sinal de que alguém abriu
uma porta que não devia.

## 4. Limitações honestas (documente na UI, não esconda)

- A precisão temporal é **a janela entre dois imports**. Se o usuário importa a cada 15 dias,
  o app sabe que fulano saiu "entre 01/03 e 15/03", não a hora exata. A UI deve dizer isso.
- **Export pedido com período limitado não traz a base completa de seguidores.** É a falha
  mais destrutiva que conhecemos: comparar um export de 12 meses com um completo faz o app
  acusar centenas de saídas que nunca aconteceram. Detectado em `detectDataWindow()`,
  sinalizado em `Snapshot.warnings` e em `SnapshotDiff.reliability`. Nunca imprima a lista
  de nomes sem mostrar esse aviso antes.
- **O export em HTML declara o fuso errado** (diz "UTC" e não está em UTC). O parser deriva
  o offset real do cabeçalho. Não assuma UTC nem o fuso do aparelho sem tentar derivar.
- Para **novos seguidores**, o export traz `timestamp` do momento em que a pessoa passou a
  seguir → aqui a data é exata. Use isso e diferencie na UI dos casos aproximados.
- O export leva de minutos a ~48h para o Instagram preparar. O onboarding precisa lidar com
  essa espera sem parecer que o app travou.
- Não temos dados de engajamento de terceiros (quem curtiu/viu seus stories não vem no
  export). Não invente métrica de "ghost follower" baseada em engajamento — não temos a fonte.

## 5. Stack

| Camada | Escolha | Motivo |
|---|---|---|
| Mobile | React Native + Expo (TypeScript) | uma base para iOS e Android; dono já usa Node |
| Backend | Node.js + Fastify + TypeScript | mesma linguagem do app e do core |
| Banco | PostgreSQL | snapshots históricos, queries analíticas |
| Lógica | pacote `core` isolado, sem I/O | testável, roda no app e no servidor |
| Monorepo | npm workspaces | simples, sem ferramenta extra |

**Decisão de arquitetura importante:** o pacote `core` é puro — recebe objetos, devolve
objetos, não lê arquivo nem rede. Isso permite rodar o parsing **no dispositivo** (modo
offline/privado) ou **no servidor** (modo sync entre dispositivos) sem duplicar lógica.
Mantenha essa pureza. Não importe `fs`, `axios` ou nada de plataforma dentro de `core`.

## 6. Estrutura

```
packages/core/     lógica pura: parser (JSON e HTML), diff, estatísticas, métricas
packages/api/      Fastify: auth, upload de snapshot, relatórios, OAuth oficial
packages/app/      Expo: telas, import do zip, visualizações
docs/              produto, arquitetura, formato do export, modo conectado, roadmap
```

## 7. Convenções de código

- TypeScript estrito. `strict: true`, sem `any` implícito, sem `@ts-ignore` sem comentário.
- Sem classe onde função pura resolve. `core` é funcional.
- Nomes de domínio em inglês no código (`follower`, `snapshot`, `unfollowEvent`),
  textos de interface em português.
- Datas sempre em UTC no banco e no core; converter para local só na camada de UI.
- Erros de parsing nunca derrubam o import inteiro: colete em um array `warnings` e
  siga com o que deu para ler. O export do Instagram muda de formato sem aviso.
- Testes: Vitest. Todo comportamento de `core/src/diff.ts` e `core/src/stats.ts`
  precisa de teste. Essa é a lógica que o usuário confia — se errar, o produto morre.

## 8. Como rodar

```bash
npm install              # na raiz, instala todos os workspaces
npm run test             # testes do core
npm run dev:api          # sobe o Fastify em :4891
npm run dev:app          # sobe o Expo
```

## 9. Estado atual

O `core` está completo e validado contra um export real (76 testes). A `api` está
implementada e rodando em produção. O que falta está em `docs/ROADMAP.md`.

**Conta opcional (decisão do dono, 16/08/2026).** Entre 14 e 16/08/2026 a conta foi
obrigatória e nenhuma tela abria sem sessão. Foi revertido porque **nenhuma função do app
depende de conta**: parsing, diff, estatísticas, listas e atividade rodam sobre arquivos no
próprio aparelho. Exigir cadastro antes de a pessoa ver qualquer resultado punha uma parede
no começo de um funil que já tem uma espera de até 48h do Instagram no meio.

A conta serve para: guardar o histórico fora do celular, trocar de aparelho sem perder
nada, e o plano pago quando existir. Ela é oferecida em dois lugares, nunca antes de o app
ter entregue alguma coisa:

- `components/ConviteDeConta.tsx`, no painel, **depois do primeiro import** — quando a
  pessoa acabou de ver a própria rede e passa a ter algo concreto a perder. Dispensável, e
  volta no import seguinte.
- `screens/PerfilScreen.tsx`, sempre.

Ao criar conta depois de já ter importado, `enviarPendente` sobe os snapshots locais — é o
que torna honesta a promessa do convite. Não quebre isso.

O que **não** mudou, e não pode mudar: a senha pedida é a do Rastro. A regra 1 continua
inteira, e a tela de entrada afirma isso acima dos campos, porque o usuário chega de apps
que pedem a senha do Instagram e vai supor que aqui é igual.

**Telemetria (16/08/2026).** `packages/app/src/lib/telemetria.ts` manda relatos de falha de
parsing e de erro fatal para `POST /reports`. Só código, arquivo e contagem — **nunca** o
`detail` de um `ParseWarning`, que é texto livre e carrega o @ do usuário dentro da frase.
O schema no servidor é `.strict()` e há testes travando isso. O painel do dono fica em
`/admin`, protegido por `ADMIN_EMAILS`, e não mostra dado de snapshot de ninguém.

**Primeiro teste em aparelho (19/08/2026).** Um Galaxy A51 com o APK do perfil
`preview` derrubou três coisas que o navegador nunca mostraria, e as três estão
consertadas:

- **O import não funcionava.** `escolherArquivoDoExport` pedia
  `copyToCacheDirectory: true`, e o Android copiava o zip inteiro antes de
  devolver — sem retorno visível na tela. Quando a cópia falhava, a exceção caía
  fora do `try` do `escolherArquivo` e virava rejeição não tratada: silêncio
  absoluto. Agora o `content://` é aberto direto (`File.open(FileMode.ReadOnly)`
  aceita SAF desde o SDK 57), a cópia sobrou só como fallback, o `try` cobre a
  escolha e toda falha vira `relatarErro` + alerta com causa.
- **A barra de navegação do sistema cobria o botão principal.** O `SafeAreaView`
  do `react-native` não faz nada no Android. Entrou
  `react-native-safe-area-context` — **módulo nativo, exige build novo**.
- **A tela de importar era uma parede de texto na primeira abertura.** Virou
  `screens/BemVindoScreen.tsx`, quatro slides, e o procedimento na tela de
  importar agora vem recolhido a partir da segunda visita.

Nada disso é testável no `expo start --web`. O caminho nativo de arquivo, a área
segura e o botão voltar só existem no aparelho — teste lá antes de dar por feito.

**Tema claro e a espera real (19/08/2026).** Duas correções vindas do mesmo teste em aparelho:

- **O app é branco e roxo**, por decisão do dono. Os tokens estão em
  `packages/app/src/lib/theme.ts`, que documenta a fronteira: copiar a
  **estrutura** do Instagram (fundo branco, abas embaixo, listas com avatar
  redondo) é gramática de app e é o que reduz o custo de aprender a usar; copiar
  **logotipo, nome ou o gradiente roxo-rosa-laranja** é motivo de remoção das
  lojas, e continua proibido. O roxo daqui é um violeta próprio e a marca segue
  sendo a trilha de `components/Marca.tsx`. As cores do gerador de ícones
  (`scripts/gerar-icones.mjs`) são duplicadas de propósito — ele roda em Node e
  não pode importar o tema; se mudar um, mude o outro.
- **A espera do export é de minutos, não de 48 horas.** Medido no aparelho do
  dono: pedindo só "Seguidores e seguindo", o arquivo chegou em ~5 minutos. As 48h
  são o teto que o Instagram publica e valem para quem pede o export completo.
  Anunciá-las como regra assusta na hora errada e faz desistir gente que teria o
  arquivo em minutos — então a ressalva existe, mas em letra miúda. Onde o texto
  fala de espera: `BemVindoScreen`, o passo 6 de `ImportGuideScreen`,
  `notificacoes.ts` e `AtividadeScreen` (esta última fala do export **completo**,
  onde as horas são reais — não uniformize).

**Tipografia e gradientes (20/08/2026).** Segunda passada de layout, também a
pedido do dono, que achou o resultado anterior "com cara de HTML sem estilo":

- **Títulos usam a Outfit**, empacotada via `@expo-google-fonts/outfit` — não há
  download em runtime. Os presets estão em `heading` (`theme.ts`) e já trazem
  família, corpo e espaçamento entre letras. **Quem passa `fontFamily` não passa
  `fontWeight`**: o peso está no nome do arquivo, e combinar os dois faz o Android
  sintetizar um negrito falso por cima de um arquivo que já é negrito. O corpo do
  texto continua na fonte do sistema, que é a que se lê mais rápido em 13px.
- **O roxo é gradiente**, não cor chapada: `gradients.marca` no botão e na barra
  de progresso, `gradients.aro` no anel do avatar, `gradients.suave` no cabeçalho
  do painel e nos halos das boas-vindas. Use sempre o componente `Gradiente`
  (`components/ui.tsx`) — gradiente repetido à mão diverge no terceiro uso.
- **O anel do avatar não é enfeite.** Ele marca o dono da conta no painel e quem
  entrou desde o arquivo anterior. Espalhá-lo por todos os avatares tira o
  significado e deixa a lista de quem saiu com cara de festa.
- **O fundo é off-white lilás** (`#FCFBFE`), não branco puro. Branco de papel numa
  tela inteira lê como página sem folha de estilo.

Dependências nativas que entraram e **exigem build novo**: `expo-font`,
`expo-linear-gradient` e `react-native-safe-area-context`.

**O descritor de `content://` que morre sozinho (20/08/2026).** O import morria
no Galaxy A51 com `java.io.IOException: Bad file descriptor` em
`FileChannelImpl.position0`, vindo de `FileSystemFileHandle.setOffset` — na
primeira leitura, que é a assinatura do zip no byte 0.

Foi diagnosticado **errado duas vezes** antes de acertar, e o registro fica aqui
porque o erro de leitura é instrutivo:

1. *"O `content://` não aceita `lseek`"* — falso. Isso daria `ESPIPE` /
   `Illegal seek`. `Bad file descriptor` é `EBADF`: o descritor está inválido ou
   **já fechado**. O problema não é a capacidade do arquivo, é o descritor não
   estar mais lá na hora do uso.
2. *"Então basta sondar antes"* — pior ainda. A sondagem da 0.2.1 abria,
   saltava, lia e fechava; passava; e o arquivo morria na leitura seguinte. E ela
   fecha um descritor para o mesmo `content://` momentos antes da abertura
   definitiva, o que a torna suspeita de ser parte da causa. Ela saiu.

O conserto não tenta adivinhar: lê no lugar e, **se a leitura falhar, copia e
refaz a mesma leitura na cópia**, transparente para quem chamou — `ler` recebe o
intervalo em cada chamada, então repetir na cópia dá o mesmo resultado. Vale uma
vez, em qualquer ponto do import, e termina sempre num `file://` no cache do app.
Quando o caminho rápido não serve, o custo é uma leitura de 4 bytes que falha.

A cópia é `await original.copy()` e não `copySync` — meio gigabyte com a thread
de JS travada não repinta nem o rótulo do botão — e tem fase própria no import
(`preparando`), sem a qual ela é indistinguível de travamento. Cópias de imports
que morreram no meio são varridas do cache no import seguinte.

Duas lições: **abrir não prova que dá para ler**, e **sondagem que não exercita a
capacidade real só produz falso positivo**. Quando não dá para testar antes,
recupere-se depois.

**O painel de erros (20/08/2026).** O `/admin` guardava a pilha do crash desde
sempre e nunca a mostrava — o dono teve de inspecionar o HTML para ler o erro
acima, porque a mensagem vivia num `title=` cortado com reticências. Agora os
crashes aparecem **agrupados** ("o que está quebrando", 30 dias) e **um a um**,
cada um com a pilha inteira num bloco selecionável e um botão de copiar — com
alternativa via `textarea` para quando o painel for aberto sem https, onde
`navigator.clipboard` não existe.

O teto da `message` subiu de 500 para 1000 caracteres: no Android o erro vindo do
módulo nativo traz o rastro de pilha do Java **dentro da própria mensagem**, e
500 cortava no meio do que dizia onde estourou. A `stack` deixou de ter as
quebras de linha achatadas. Nada disso afrouxa a regra 5: o schema continua
`.strict()`, o `detail` de `ParseWarning` continua fora, e o teste que trava isso
continua no lugar.

**Conversas e a data de quem saiu (20/08/2026).** Primeiro uso de verdade do
app com o export completo, e três coisas vieram junto:

- **A data de "Deixaram de seguir" não é a data da saída, e o texto mentia.** O
  export não registra quando alguém deixou de seguir; o app só sabe a janela
  entre dois arquivos. Quando os dois imports caem no mesmo dia a janela colapsa
  e `describeEvent` escrevia "saiu em 20 de ago." — que lê como data exata, e
  ainda por cima é a data do import, então a lista inteira aparecia com a data de
  hoje. Agora diz "saiu entre suas duas atualizações de <dia>".
- **Perfil que não abre é informação, não defeito.** Conta apagada, banida ou que
  trocou de @ some da lista sem ninguém ter deixado de seguir. A lista de quem
  saiu diz isso agora, e passou a mostrar o aviso de `diff.reliability`, que
  existia só no painel — o CLAUDE.md sempre mandou não imprimir os nomes sem ele,
  e quem entra direto pelo menu nunca passava pelo painel.
- **Reagir com emoji conta como responder.** A reação não é mensagem: ela vive
  dentro da mensagem que responde, em `reactions[]`. Olhar só `sender_name` da
  última mensagem cobrava como não respondida a conversa respondida com ❤️ — 44
  conversas no export do dono.

**Prévia de mensagem, e o limite novo (20/08/2026).** Por decisão do dono, o
`ActivityData` passou a guardar **as duas últimas mensagens de cada conversa**,
truncadas em 140 caracteres. Antes nenhum texto de mensagem atravessava, e a
mudança é real: o app agora persiste pedaço de conversa privada no aparelho.

O que segura a decisão: `ActivityData` fica em `atividade.json`, no aparelho, e
**não tem caminho de subida para a API** — some junto com o resto em
`eraseEverything`. Mídia vira rótulo, nunca arquivo nem link. Da reação sobram o
emoji e um booleano; o nome de quem reagiu morre no rascunho. Se algum dia
alguém quiser mandar `ActivityData` para o servidor, a conversa recomeça do
zero, porque a partir daí o que sobe deixa de ser lista de @ e passa a ser DM.

**Conversa não liga a perfil, e não é bug (20/08/2026).** O arquivo de conversa
não traz @ nenhum, o nome da pasta é o `title` achatado (1.480 de 1.573) e as
listas de seguidores vêm **sem** nome de exibição (0 de 1.361). Não há coluna em
comum entre os dois lados. Normalizar mais — ignorar pontos, por exemplo — foi
tentado e desfeito no mesmo dia: ganhava 9 links e cada um seria palpite sobre
nome de exibição. Onde não há @, a linha abre a **busca** do Instagram pelo nome.
Detalhes e números em `docs/EXPORT-INSTAGRAM.md`.

**Tema escuro (20/08/2026) — a identidade atual.** Terceira e definitiva virada,
por decisão do dono, que achou o resultado claro "amador" e pediu referência em
apps de sucesso. O que Spotify e Linear têm em comum não é a cor: é que **o fundo
não compete**. Num fundo quase preto o número de seguidores é a coisa mais clara
da tela e por isso a primeira que se lê; num fundo branco ele disputa com o
próprio fundo, e a saída é engrossar a fonte — que foi o caminho das duas
tentativas anteriores.

As três regras estão escritas em `lib/theme.ts` e quebram fácil sem perceber:

1. **A cor de acento é rara.** Roxo em ação, identidade e "chegou alguém". Um
   quarto elemento roxo na mesma tela é hierarquia mal resolvida, não falta de cor.
2. **Profundidade vem da superfície, não da sombra.** No escuro, sombra preta
   sobre preto é invisível. Cartão é `surface` acima de `base`; a camada seguinte
   é `surfaceRaised`. Três níveis bastam. Use `<Grupo>` (`components/ui.tsx`) para
   agrupar linhas de menu — soltas sobre o fundo elas viram texto empilhado.
3. **Branco puro não existe.** `ink` é branco esfriado; `#FFFFFF` vibra e cansa.

Consequências que já mordem quem esquecer: `colors.gained` (`#8B5CF6`) serve como
**texto** sobre o fundo, mas texto branco **por cima** dele reprova em contraste —
para isso existe `gradients.marca`, deliberadamente mais escuro. Os tons de avatar
são escuros com a inicial clara, e não pastéis. O `StatusBar` é `style="light"`.
O `app.json` tem `userInterfaceStyle: "dark"` e todos os fundos em `#0B0B10`. As
cores do gerador de ícones (`scripts/gerar-icones.mjs`) continuam duplicadas de
propósito — ele roda em Node e não pode importar o tema; se mudar um, mude o outro.

A fronteira com o Instagram não mudou e continua no topo do `theme.ts`: copiar a
**estrutura** é gramática de app; copiar logotipo, nome ou o gradiente
roxo-rosa-laranja é motivo de remoção das lojas.

**Dado persistido de versão anterior (20/08/2026).** `atividade.json` e o índice
de snapshots foram escritos pela versão do app que estava instalada naquele dia, e
são lidos com o tipo de hoje. Um `as ActivityData` cego sobre esse JSON é mentira
para o compilador que só aparece em produção — e apareceu: `lastMessages` entrou,
o arquivo de quem já tinha importado não tinha o campo, e a tela de conversas
quebrou inteira com "Cannot read property 'length' of undefined".

A regra: **todo campo novo em dado persistido precisa de valor padrão em
`storage.completar`**, e a tela ainda assim não confia (`?? []`). O arquivo do
usuário só é reescrito no próximo import.

**A fila de faxina, e o pedido que foi recusado (21/08/2026).** O dono pediu um
botão de **deixar de seguir em massa**: marcar contas com checkbox e o app
executar tudo. A resposta foi não, e o motivo precisa ficar registrado porque o
pedido vai voltar:

- A **API oficial da Meta não tem endpoint de unfollow**. Os escopos liberados
  para terceiros são de leitura, e sempre foram.
- A única via técnica é login programático e API privada — regras 1 e 2. O
  Instagram detecta unfollow em lote vindo de fora e **bane a conta do usuário**,
  não a nossa.
- Automação de conta é remoção certa nas duas lojas — regra 4, que cita este
  caso com todas as letras.
- E seria incoerente: o argumento de venda do app é não pedir a senha do
  Instagram, e isso exigiria pedir exatamente ela.

O que existe no lugar é `lib/fila.ts` + `screens/FilaScreen.tsx`: o usuário marca
quem quer resolver, o app guarda a lista e **abre um perfil por vez**. Ele age
dentro do Instagram e volta; o app marca e abre o próximo. Vale para três listas
(`acaoDaLista`): não te seguem de volta → deixar de seguir; você não segue de
volta → seguir; solicitações pendentes → cancelar.

Duas propriedades que não podem se perder: **o app não sabe se a pessoa fez** —
`feitos` é declaração dela, e por isso todo texto é em primeira pessoa ("Deixei
de seguir"), nunca "pronto, deixamos de seguir". E os botões de desfecho só
aparecem **depois** de o perfil ter sido aberto, senão a fila vira um contador
que se zera sozinho.

**O backup deixou de ser só de ida (21/08/2026).** Desde que a conta existe, o
app **subia** snapshots e nunca baixava: quem trocasse de celular, entrasse na
conta e abrisse o app via "envie seu primeiro arquivo", com o histórico inteiro
parado no servidor. As rotas de leitura já existiam; faltava alguém chamá-las —
e era justamente a promessa que o convite de conta faz.

Agora há `GET /profiles/:id/snapshots/:id/raw` (o snapshot **cru**, não os
derivados: o app calcula insights e diffs localmente e precisa das listas para
comparar com os imports futuros) e `restaurarDoServidor()` em `lib/conta.ts`, que
baixa por diferença ao entrar. Restaurar roda **antes** de enviar: num aparelho
novo não há o que enviar, e é exatamente esse o caso que precisa do histórico.

**O zip pode ser apagado depois do import**, e o app agora diz isso. Verificado:
`extrairDoZip` chama `fonte.fechar()` no fim e nada guarda a fonte — o arquivo
não é lido de novo nunca. Como o export completo passa de 400 MB, avisar economiza
espaço real. O aviso mostra só o **nome** do arquivo: um `content://` do Android
não tem caminho de sistema que se possa exibir, e inventar um mandaria a pessoa
procurar onde não está.

**A vistoria do arquivo, e o que ela pode provar (21/08/2026).** O dono pediu para
**impedir** o import de export incompleto. Agora há `checkExport()`
(`core/src/completeness.ts`), que roda **depois do parsing e antes de gravar** —
a única ordem que serve, porque um snapshot recortado, uma vez salvo, vira a base
de comparação do próximo.

Os números que justificam a existência dela, medidos no mesmo perfil no mesmo dia:
**1.361 seguidores** pedindo "Todo o período", **222** pedindo 12 meses. E a lista
de *seguindo* veio quase completa no arquivo recortado (1.158 de 1.157), então "as
duas listas encolheram junto" não serve como sinal.

Cada problema carrega a severidade que a evidência banca, e a distinção é o ponto:

- **`block`** — há prova no arquivo: HTML, lista faltando, período declarado no
  cabeçalho, ou queda acima de 30% de **seguidores** num arquivo que não prova a
  própria profundidade.
- **`confirm`** — há indício, e a resposta está com quem conhece a conta. É o
  caso de `SHALLOW_HISTORY` (lista cobre menos de 40% da vida da conta) e do
  primeiro import, onde não há com o que comparar e o app mostra a contagem e
  pergunta se bate.
- **`warn`** — o import serve; `NO_ACTIVITY` é só isso.

**A regra de perda em massa olha `followers`, e só.** Deixar de seguir gente em
massa — o que a fila de faxina existe para organizar — derruba `following` e não
toca em `followers`; verificado no arquivo real, tirar 1.000 dos 1.162 seguidos
passa sem um único problema. Vigiar as duas listas faria o app punir quem usou a
funcionalidade que ele mesmo oferece.

E quando a queda é de **seguidores** mesmo, `MASS_LOSS` distingue: se o arquivo
alcança a criação da conta e não declara recorte, ele demonstrou não ser
truncado, e a queda vira `confirm` em vez de `block` — limpeza de contas falsas
pelo Instagram e conta que viralizou e esvaziou são eventos reais, e trancar a
pessoa fora do próprio histórico por causa deles é pior que o problema.

**Não transforme indício em bloqueio.** Conta antiga que só engatou seguidores no
último ano tem a mesma forma de um export truncado, e não há nada no arquivo que
as separe — barrá-la é expulsar usuário legítimo de um app que ele não consegue
usar de outro jeito. Quando há `block`, os `confirm` são suprimidos: não há
resposta que faça o arquivo entrar.

**JSON virou exigência.** A ordem "aceite HTML para não perder quem esperou 48h"
foi revertida em 21/08 por decisão do dono. O `htmlExport.ts` continua no core, e
não é código morto: é dele que sai `detectDataWindow`, **a única declaração de
período que existe** — o JSON não a traz em lugar nenhum. No caminho JSON a defesa
é `signup_details.json`, lido por `readAccountCreatedAt()` por *forma* (menor
epoch plausível) e nunca por rótulo, que é localizado e chega com mojibake.

A tela é `components/VistoriaDoArquivo.tsx`, o único modal do app que interrompe.
O import que espera resposta fica em `useStore().pendente` — em memória, porque
reler meio gigabyte depois de a pessoa responder cobraria a espera duas vezes.

**"Não visualizei" não existe, e não vai existir (21/08/2026).** Foi pedido, e a
varredura do export inteiro fecha o assunto: nenhuma chave de leitura, nem no
JSON, nem no HTML, nem escondida. `is_geoblocked_for_viewer` é bloqueio
geográfico; os arquivos `*_viewed` são sobre o que **você** consumiu. O Instagram
sabe (é o "visto") e não exporta; a API oficial não dá DM de conta pessoal.

No lugar entraram as duas aproximações que a fonte permite, e o texto de cada uma
diz o que ela é de verdade — nenhuma promete "não visto":

- **`neverReplied`** — você nunca mandou nada nessa conversa. São 66, contra 644
  de `awaitingYou`. A diferença é a diferença entre um inventário e uma tarefa.
- **`isRequest`** — veio de `messages/message_requests/`, a caixa que o Instagram
  esconde atrás de "Solicitações". São 39, e **38 nunca foram respondidas**.

O app lia só `messages/inbox/` até aqui. E o padrão de nome `message_\d+\.json`
descartava em silêncio uma conversa real: com pasta de nome longo o Instagram
trunca o caminho e o arquivo chega como `messa.json`.

**Modo conectado, agora com tela (21/08/2026).** O servidor tinha OAuth, coleta e
agendador desde 15/08 e nenhum botão. Agora tem
`screens/ConectarInstagramScreen.tsx`, entrada em Perfil → "Conectar ao Instagram
(só números)" — o parêntese é a última chance de dizer a limitação antes de a
pessoa investir tempo numa autorização.

E o aviso que o dono pediu: quando a contagem cai, sai um push
(`api/src/lib/push.ts` + `quedaDeSeguidores.ts`, tabelas já existentes desde a
migração 002). O texto **é sobre número** — "Você perdeu 3 seguidores… para saber
quem saiu, importe um arquivo novo". "@fulano deixou de te seguir" é impossível
por dois motivos somados: o dado não existe neste caminho, e push atravessa Apple
e Google em claro e aparece na tela de bloqueio. Não avisa alta: app que
interrompe com boa notícia todo dia é silenciado, e junto vai o aviso que a
pessoa queria.

**Falta o que não é código**: criar o app na Meta e preencher `INSTAGRAM_APP_*`,
passar pelo App Review de `instagram_business_manage_insights` (semanas, e
independente das lojas), e a credencial de push no EAS. Sem eles a tela diz
"ainda não disponível", que é o estado correto. Ver `docs/MODO-CONECTADO.md`.

**Comentários recebidos e a caixa fantasma (22/08/2026).** Decisão do dono, e a
maior mudança de postura do projeto até aqui: o servidor passou a **guardar
conteúdo** vindo da API oficial — comentários nos posts do usuário e mensagens
diretas que chegam pelo webhook.

Até 21/08 nenhum texto de conversa saía do aparelho, e o `activity.ts` dizia com
todas as letras que mandar `ActivityData` para a API "recomeça a conversa do
zero". A conversa aconteceu. Levantei o custo, o dono reafirmou e propôs o que
tornou a decisão defensável: **criptografia ponta a ponta**.

O aparelho gera um par X25519 (`app/src/lib/cofre.ts`), manda só a pública, e a
privada fica no Keychain/Keystore. O webhook sela com a pública
(`api/src/lib/cofre.ts`) antes de tocar no banco. **O servidor grava sem poder
ler** — cada selo usa um par efêmero descartado na função, então nem o processo
que cifrou consegue voltar atrás. Perfil sem chave registrada faz o webhook
**descartar** o evento; guardar em claro "só até o app registrar a chave" é como
toda promessa de criptografia morre.

O que **não** mudou, e não pode mudar:

- **Nada de escrita.** Os escopos novos (`manage_comments`, `manage_messages`)
  autorizam responder, ocultar e apagar. Nenhuma função deste projeto faz isso —
  regra 4, a mesma que recusou o unfollow em massa. Se aparecer uma chamada de
  escrita em `instagramApi.ts`, ela nasceu de um pedido que a regra recusa.
- **Nenhuma coluna em claro guarda texto de pessoa.** Metadado (`thread_id`,
  quando, se foi o usuário que mandou) fica legível porque a listagem ordena por
  ele; conteúdo, nunca. E nada disso vai para `/admin`.
- **Retenção curta** (`INSTAGRAM_CONTENT_RETENTION_DAYS`, 30 dias), varrida pelo
  agendador. Desconectar apaga na hora.

O que a criptografia **não** resolve, e a documentação diz em vez de fingir:
entre o webhook e a cifragem o texto está na memória do processo, e os metadados
ficam em claro. Quem lê o banco sabe *que* houve conversa e *quando* — só não
sabe o quê.

Limites da fonte que a tela precisa repetir, porque calados parecem defeito: a
API **não tem endpoint de histórico** (só chega o que vem depois de conectar),
grupo e conversa iniciada pelo usuário não vêm, e **celular novo não abre o que
foi selado para o antigo** — é o preço da ponta a ponta, e o banner diz isso.

Ler pela API de fato não marca como visto no Instagram; a documentação da Meta é
explícita, e está citada em `CaixaFantasmaScreen.tsx`.

Dependências que entraram e **exigem build novo**: `expo-crypto` (nativa, para o
PRNG do tweetnacl — sem ela a geração de chave lança **só no aparelho**) e
`tweetnacl` (JS puro, nos dois lados). O base64 mora em `core/src/base64.ts` e
tem teste contra o `Buffer` do Node: um byte errado no preenchimento não daria
erro, daria "a mensagem não abre", num celular, sem pista da causa.

Antes de mexer no parser, consulte `docs/EXPORT-INSTAGRAM.md` — ele documenta o formato
real dos dois formatos (JSON e HTML) e as armadilhas já encontradas em arquivo de verdade.

Antes de mexer em qualquer coisa que fale com o Instagram, consulte
`docs/MODO-CONECTADO.md`.
