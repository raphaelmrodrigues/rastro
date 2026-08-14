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

**Conta obrigatória (decisão do dono, 14/08/2026).** Até essa data o app funcionava
inteiro sem conta e a sincronização era opt-in. Hoje nenhuma tela abre sem sessão: quem
não entra vê apenas `screens/AuthScreen.tsx`. O processamento continua acontecendo no
aparelho — o `.zip` nunca sai dele, e o que sobe é a lista já processada —, mas isso
deixou de ser uma escolha do usuário e por isso **não deve mais ser explicado na
interface**. Explicar uma decisão que a pessoa não toma é ruído.

O que **não** mudou, e não pode mudar: a senha pedida na entrada é a do Rastro. A regra 1
continua inteira, e a tela de entrada afirma isso acima dos campos, porque o usuário chega
de apps que pedem a senha do Instagram e vai supor que aqui é igual.

Antes de mexer no parser, consulte `docs/EXPORT-INSTAGRAM.md` — ele documenta o formato
real dos dois formatos (JSON e HTML) e as armadilhas já encontradas em arquivo de verdade.

Antes de mexer em qualquer coisa que fale com o Instagram, consulte
`docs/MODO-CONECTADO.md`.
