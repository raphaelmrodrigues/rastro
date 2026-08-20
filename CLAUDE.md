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

Antes de mexer no parser, consulte `docs/EXPORT-INSTAGRAM.md` — ele documenta o formato
real dos dois formatos (JSON e HTML) e as armadilhas já encontradas em arquivo de verdade.

Antes de mexer em qualquer coisa que fale com o Instagram, consulte
`docs/MODO-CONECTADO.md`.
