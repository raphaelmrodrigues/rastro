# Modo conectado — usar a API oficial, sem arquivo

Resposta curta à pergunta "dá para o app funcionar sem o usuário baixar o export?":

> **Em parte.** Sem arquivo dá para saber *quantos*. Nunca *quem*.

Este documento existe para que essa fronteira não seja reaberta por engano daqui a
seis meses.

## O que a API oficial entrega

A API da Meta para contas profissionais (*Instagram API with Instagram Login*, e a
variante via Facebook Login) dá acesso a:

| Dado | Endpoint / métrica | Observação |
|---|---|---|
| Contagem de seguidores | `GET /me?fields=followers_count` | número atual, sem histórico |
| Contagem de seguindo / posts | `follows_count`, `media_count` | idem |
| Entradas e saídas por período | insights `follows_and_unfollows`, breakdown `follow_type` | agregado, sem nomes |
| Demografia da audiência | insights `follower_demographics` (`country`, `city`, `age`, `gender`) | agregado, só 100+ seguidores |
| Alcance e visualizações | insights `reach`, `views` | por post e por conta |

Tudo isso atualiza sozinho, sem espera de 48h e sem o usuário fazer nada depois de
conectar uma vez.

## O que a API oficial não entrega, e não vai passar a entregar

**A lista de seguidores.** Não existe endpoint para isso. Não é uma permissão que
falte pedir, nem um escopo a aprovar em App Review: o recurso foi removido junto com
a API antiga e não tem substituto. Consequências diretas:

- não dá para saber **quem** deixou de seguir;
- não dá para saber **quem** começou a seguir;
- não dá para saber **quem não te segue de volta**;
- não dá para listar solicitações pendentes.

Essas quatro coisas são o núcleo do produto, e todas dependem do arquivo de export.

## Por que não "resolvemos" isso

Existe um jeito técnico de obter a lista sem o export: usar a API privada do app do
Instagram, com a sessão logada do usuário. É o que faz a maior parte do nicho, e é
exatamente o que as regras 1 e 2 do `CLAUDE.md` proíbem.

O custo não recai sobre nós. Recai sobre a conta de quem usa o app: bloqueio de
ações, checkpoint, e em alguns casos banimento. Um app que quebra a conta do cliente
para entregar uma tela não é um app melhor.

Então a resposta ao usuário é a verdade, dita na tela `SobreOArquivoScreen`: para saber
*quem*, precisa do arquivo. Para acompanhar o número no dia a dia, o modo conectado
resolve.

## Por que os dois modos juntos

Eles falham em pontos opostos:

|  | Arquivo | Conectado |
|---|---|---|
| Nomes | sim | não |
| Frequência | manual, a cada 15 dias na melhor das hipóteses | diária, automática |
| Histórico anterior ao app | sim (o export traz a data de entrada de cada seguidor) | não, começa do zero |
| Conta pessoal | funciona | exige conta profissional |
| Demografia, alcance | não tem | tem |

O modo conectado tapa o buraco de frequência do import; o import tapa o buraco de
identidade da API. Nenhum dos dois substitui o outro.

## Requisitos para o usuário

1. Conta **Profissional** (Business ou Creator). A conversão é gratuita e reversível
   nas configurações do Instagram.
2. **100 seguidores ou mais** para as métricas de `follows_and_unfollows` e
   demografia. Abaixo disso a Meta não devolve os dados — e isso não é erro do app.
3. Autorização pelo login oficial, revogável a qualquer momento nas configurações da
   conta do Instagram.

## Como funciona por dentro

```
usuário toca "conectar"
        ↓
POST /instagram/profiles/:id/connect  →  devolve authorizeUrl (state anti-CSRF)
        ↓
usuário autoriza NO SITE DO INSTAGRAM (a senha nunca passa por nós)
        ↓
GET /instagram/callback?code=...&state=...
        ↓
troca code → token curto → token longo (60 dias), cifrado em AES-256-GCM
        ↓
scheduler amostra 1x por dia:  followers_count  +  follows_and_unfollows
        ↓
core.buildDailySeries()  →  série diária, com gapDays marcando falha de coleta
```

Detalhes que não são acidentais:

- **A série é nossa.** A API só devolve o número de agora; o histórico existe porque
  amostramos todo dia. Por isso o modo conectado não tem passado — ele começa a
  contar quando o usuário conecta.
- **O token é cifrado em repouso** (`TOKEN_ENCRYPTION_KEY`). Um dump do banco não
  pode virar acesso à conta de ninguém.
- **Falha de insights não invalida a amostra de contagem.** Conta com menos de 100
  seguidores não recebe a métrica, e isso é limite da fonte, não erro.
- **Amostra sem `followers_count` não é gravada.** Uma amostra falsa com zero vira um
  despencar no gráfico que o usuário lê como perda real.

## Configuração

Tudo opcional. Sem as variáveis abaixo, as rotas `/instagram` respondem 503 e o
resto do produto funciona igual.

```
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
INSTAGRAM_REDIRECT_URI=http://localhost:4891/instagram/callback
TOKEN_ENCRYPTION_KEY=      # openssl rand -base64 32
```

O app é criado em developers.facebook.com → produto "Instagram" → *API setup with
Instagram login*. Escopos usados: `instagram_business_basic` e
`instagram_business_manage_insights` — o mínimo. Nada de publicação, mensagens ou
comentários, que o produto não usa e que só aumentariam a superfície do App Review.

## Onde isto está no código

| Arquivo | Papel |
|---|---|
| `packages/core/src/metrics.ts` | tipos e transformações puras; `MODE_CAPABILITIES` |
| `packages/api/src/lib/instagramApi.ts` | **único** ponto do projeto que fala com o Instagram |
| `packages/api/src/routes/instagram.ts` | OAuth, coleta, endpoints |
| `packages/api/src/lib/scheduler.ts` | amostragem diária |
| `packages/app/src/screens/SobreOArquivoScreen.tsx` | a explicação honesta, para o usuário |

## Estado em 21/08/2026: a interface existe; falta o app da Meta

Entre 15 e 21/08 o modo conectado era servidor sem tela. Agora tem:

| Arquivo | Papel |
|---|---|
| `packages/app/src/screens/ConectarInstagramScreen.tsx` | conectar, série, desconectar |
| `packages/app/src/api/client.ts` | `iniciarConexaoInstagram`, `lerMetricasDoInstagram`, … |
| `packages/api/src/lib/push.ts` | o aviso de queda, por push |
| `packages/api/src/lib/quedaDeSeguidores.ts` | quando avisar, e quando calar |
| `packages/api/src/routes/avisos.ts` | registro de aparelho e preferências |

O caminho de entrada é Perfil → "Conectar ao Instagram (só números)". O rótulo tem
o parêntese de propósito: é a última chance de dizer a limitação antes de a pessoa
investir tempo numa autorização.

### O caso de uso do app, e por que ele importa (21/08/2026)

Ao criar o app, a Meta pede um **caso de uso**. O dono escolheu *"Gerenciar
mensagens e conteúdo no Instagram"*, e ele **não concede o que o Rastro usa**:

| caso de uso | concede | serve ao Rastro? |
|---|---|---|
| Gerenciar mensagens e conteúdo | `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_content_publish`, `instagram_business_manage_comments` | não |
| **o que precisamos** | `instagram_business_basic` + **`instagram_business_manage_insights`** | sim |

Com o caso de uso errado o OAuth falha na hora: `authorizeUrl()` pede
`instagram_business_manage_insights` e o Instagram recusa um escopo que o app não
declara. Conserta-se **sem criar app novo** — no painel, o caso de uso tem um
botão *Personalizar*, que leva a "Permissões e recursos", onde se adiciona a
permissão que falta.

**E remova as outras três.** Não é higiene, é produto:

- `instagram_business_content_publish` permite **publicar** na conta do usuário;
- `instagram_business_manage_messages` permite **ler e enviar** DM.

As duas são escrita na conta de quem usa o app — exatamente a regra 4 do
CLAUDE.md, a mesma que fez o pedido de "deixar de seguir em massa" ser recusado.
Além disso, o App Review de mensagens é bem mais rigoroso (a Meta pede
demonstração em vídeo e questiona o propósito), e pedir escopo de escrita
contradiz o argumento de venda do app, que é não encostar na conta de ninguém.
Cada escopo pedido é uma pergunta a mais que a revisão faz, e uma linha a mais na
tela de autorização que o usuário lê antes de decidir.

Sobre a tentação óbvia: `instagram_business_manage_messages` **não** resolve o
"não visualizei" da seção de mensagens do `EXPORT-INSTAGRAM.md`. A Messaging API
é para conta de negócio responder cliente, funciona por webhook a partir do
momento da conexão e não devolve histórico. E mesmo que devolvesse, passaria a DM
do usuário pelo nosso servidor — o oposto do limite escrito em `core/src/activity.ts`.

### Quais permissões marcar, das 29 oferecidas

**Duas. Só estas:**

```
instagram_business_basic
instagram_business_manage_insights
```

São exatamente as de `SCOPES` em `lib/instagramApi.ts`. Pedir mais do que o
código usa não adiciona recurso nenhum — adiciona linha na tela de autorização e
pergunta no App Review.

A lista do painel confunde porque mistura **dois setups incompatíveis**, e o
prefixo é a única pista:

| prefixo | setup | serve? |
|---|---|---|
| `instagram_business_*` | Instagram API **with Instagram Login** | **é o nosso** |
| `instagram_*` (sem `business_`) | Instagram API **with Facebook Login** | não |
| `pages_*`, `ads_*`, `business_management`, `email`, `public_profile` | Graph API do Facebook | não |

`instagram_manage_insights` e `instagram_basic` parecem os certos e não são: são
os gêmeos do caminho por Facebook Login, que exige Página do Facebook vinculada à
conta. Marcá-los não quebra nada e não faz nada — o OAuth do Instagram Login os
ignora, e a revisão pergunta por que estão ali.

Descartados por não servirem ao produto, para não serem reavaliados a cada
release: `Instagram Public Content Access` (busca por hashtag),
`instagram_creator_marketplace_discovery`, `instagram_branded_content_*` (publi),
`instagram_shopping_tag_products`, `instagram_manage_upcoming_events`,
`Human Agent`, `Business Asset User Profile Access`.

### O "modo fantasma" — implementado em 22/08/2026

O dono reafirmou o pedido depois de ler a avaliação abaixo, e propôs o que a
tornava aceitável: **criptografar o conteúdo de ponta a ponta**. Foi feito assim,
e é essa criptografia que sustenta a decisão inteira.

**Como funciona:**

1. O aparelho gera um par X25519 (`app/src/lib/cofre.ts`) e manda **só a
   pública**. A privada mora no Keychain/Keystore e nunca sai dali.
2. O webhook (`api/src/routes/instagramWebhook.ts`) recebe o evento, sela com
   essa pública (`api/src/lib/cofre.ts`) e grava.
3. O app baixa os selos e abre localmente.

O servidor guarda sem poder ler. Não é "prometemos não olhar" — é não ter como.
Cada selo usa um par efêmero descartado na função, então nem o processo que
acabou de cifrar consegue voltar atrás.

**O que continua fora:** responder, ocultar e apagar. Os escopos autorizam; a
regra 4 do CLAUDE.md não. É a mesma regra que recusou o unfollow em massa, e a
tela não tem esses botões.

**Fronteiras que a tela precisa dizer, e diz:**

| limite | onde aparece |
|---|---|
| só chega o que veio depois de conectar | estado vazio de `CaixaFantasmaScreen` |
| grupo e conversa iniciada por você não vêm | mesmo estado vazio |
| celular novo não abre o histórico do antigo | banner "Cofre novo neste aparelho" |
| item selado para outra chave não abre | banner "N itens não abriram" |

E as que **nenhuma criptografia resolve**, registradas para ninguém prometer
demais: entre o webhook e a cifragem o texto está na memória do processo — um
servidor comprometido *naquele instante* lê o que passa dali em diante, embora
não alcance o histórico. E os metadados (`thread_id`, quando, se foi você quem
mandou) ficam em claro, porque a listagem ordena e pagina por eles: quem lê o
banco sabe *que* houve conversa e *quando*, só não sabe o quê.

Retenção: `INSTAGRAM_CONTENT_RETENTION_DAYS`, 30 dias por padrão, varrida pelo
agendador. O modo fantasma serve para ler o que chegou agora; sem prazo, o Rastro
viraria arquivo paralelo da caixa de entrada de alguém — passivo enorme e nenhuma
funcionalidade. Desconectar a conta apaga tudo na hora.

### A avaliação original, e por que ela continua aqui

Segue o levantamento que precedeu a decisão. Ele não foi apagado porque os
limites técnicos que descreve **não mudaram** — só passaram a ser ditos na tela
em vez de impedir o recurso.

### O "modo fantasma" de mensagens — avaliado e recusado (22/08/2026)

Ideia do dono: usar a API para o usuário **ler as DMs dentro do Rastro sem dar
"visto"** no Instagram, e poder ocultar ou excluir. Fica registrado porque a
ideia é boa o bastante para voltar.

**O fato que a sustenta é verdadeiro.** A documentação da Messaging API é
explícita:

> "Webhooks notifications or messages delivered via the API will not be
> considered as Read in the Instagram app inbox. Only after a reply is sent will
> a message be considered Read."

Ou seja: ler pela API de fato não marca como lido. A premissa técnica está certa.

**O que ela entregaria na prática, porém, é quase nada:**

| limite | efeito |
|---|---|
| escopo é `instagram_business_manage_messages`, não `manage_comments` | o que foi marcado no painel não serve para isto |
| não há endpoint de histórico | só chega o que entra por webhook **depois** de conectado |
| conversa precisa ser iniciada pelo outro lado | mensagem que o usuário mandou primeiro não aparece |
| grupos não são suportados | some boa parte do inbox real |
| pasta de solicitações some após 30 dias de inatividade | justamente a caixa mais interessante |
| só conta profissional | quem tem conta pessoal não vê nada |

Uma tela de "mensagens sem dar visto" que só mostra mensagens novas, de conversas
individuais, iniciadas pelo outro, em conta profissional, é uma tela vazia para a
maioria — e vazia de um jeito que parece defeito.

**E o custo é alto:**

1. **As DMs passariam pelo nosso servidor.** O webhook entrega no backend, não no
   aparelho. Isso cruza a linha escrita no topo de `core/src/activity.ts`: hoje
   `ActivityData` não tem caminho de subida, e o que sobe é lista de @, não DM.
   A partir daí o banco do Rastro guarda conversa privada de terceiros — porque
   quem escreveu a mensagem não é usuário nosso e não consentiu nada.
2. **Ocultar e excluir é escrita na conta** — regra 4 do CLAUDE.md, a mesma que
   recusou o unfollow em massa.
3. **O App Review de mensagens põe em risco o de insights.** A Messaging API é
   declaradamente para conta profissional atender cliente: janela de 24h para
   responder, tag de agente humano para estender a 7 dias, limite de 200 DMs
   automatizadas por hora. "Ler sem dar visto" não é um caso de uso da
   plataforma, e submetê-lo junto com o que o app precisa arrisca os dois.

A decisão foi do dono, que reafirmou e resolveu o item 1 com criptografia ponta a
ponta. Os itens 2 e 3 continuam valendo: nada de escrita, e o App Review de
mensagens é o mais arriscado dos quatro escopos pedidos.

### O único candidato futuro: comentários

`instagram_business_manage_comments` é o único da lista que abriria capacidade de
verdade. Ele dá **quem comentou nos seus posts, com nome** — e isso ataca de
frente o buraco declarado na seção 4 do CLAUDE.md: o export traz os comentários
que *você* fez, nunca os que *você recebeu*.

Seria a primeira vez que o app teria dado nominal de engajamento de terceiros.

Ainda assim está fora hoje, por três motivos que valem mais que a funcionalidade:

1. A mesma permissão que lê comentário permite **responder, ocultar e excluir**.
   Nada no código faria isso, mas o token concedido pode — e um token nosso
   vazado passaria a ser capaz de escrever na conta do usuário. Regra 4.
2. Cada escopo é uma linha a mais na tela que a pessoa lê antes de autorizar. Num
   app cujo argumento de venda é "não encosto na sua conta", a terceira linha
   custa mais do que parece.
3. O App Review fica mais demorado, e o modo conectado ainda não passou nem pela
   primeira aprovação.

Se for adicionado algum dia, que seja depois de o modo conectado estar no ar e
com uma tela concreta esperando o dado — não "porque estava na lista".

**Atualização (22/08/2026): o dono adicionou a permissão.** Então ela existe, e o
que dá para construir com ela é uma tela de **"quem comenta em você"** — nomes,
frequência, e quem comentou e você nunca respondeu. É o espelho exato de
`parseComments` do export (que só tem os comentários que *você* fez) e a primeira
vez que o app teria nome de terceiro que interage.

O que continua fora: responder, ocultar e excluir comentário. A permissão
autoriza; a regra 4 não.

### Sobre "trazer o máximo de informação ao usuário"

Vale registrar, porque a lista de 29 permissões convida ao contrário: **o
diferencial do Rastro não está na API.** Está no arquivo.

A lista nominal de quem saiu, quem não te segue de volta e quem nunca respondeu
não existe em API nenhuma — nem para nós, nem para a concorrência que pede senha.
É o produto inteiro, e ele já funciona sem uma permissão sequer.

O que a API acrescenta é **frequência**: o número atualiza sozinho todo dia, em
vez de esperar o próximo export. Esse é o papel dela, e é por isso que duas
permissões bastam.

### Métricas que a API oferece e ainda não usamos

Levantado em 21/08/2026 na referência de insights. Hoje o app coleta só as duas
primeiras:

| métrica | período | breakdowns | exige |
|---|---|---|---|
| `follows_and_unfollows` ✅ | day | `follow_type` | 100+ seguidores |
| `follower_demographics` ✅ | lifetime | age, city, country, gender | 100+ seguidores |
| `reach` | day | `media_product_type`, **`follow_type`** | — |
| `views` | day | **`follower_type`**, `media_product_type` | — |
| `total_interactions` | day | `media_product_type` | — |
| `likes`, `comments`, `saves`, `shares`, `reposts`, `replies` | day | `media_product_type` | — |
| `accounts_engaged` | day | — | — |
| `engaged_audience_demographics` | lifetime | age, city, country, gender | 100+ engajamentos |
| `profile_links_taps` | day | `contact_button_type` | — |

Duas merecem atenção. `reach` e `views` com breakdown por tipo de seguidor
respondem **"meu conteúdo alcança gente que ainda não me segue?"** — que é a
pergunta por trás de "por que não estou crescendo", e o arquivo de export não tem
como responder. E `engaged_audience_demographics` é a demografia de **quem
interage**, não de quem segue: as duas divergirem é informação real.

Isto preenche um buraco que o `CLAUDE.md` declara na seção de limitações — "não
temos dados de engajamento de terceiros". Continua verdade para **nomes**; deixa
de ser para **números**, no modo conectado.

`impressions` foi descontinuada na v22.0 e não deve ser adicionada — usamos
v23.0.

**O que ainda falta, e não é código:**

1. **Criar o app na Meta** (developers.facebook.com) e preencher
   `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` e `INSTAGRAM_REDIRECT_URI` no
   Dokploy. Sem isso `/instagram/modes` devolve `available: false` e a tela diz
   "ainda não disponível" — que é o estado correto, não um erro.
2. **App Review da Meta** para `instagram_business_manage_insights`. Antes da
   aprovação, só contas listadas como testadoras no painel conseguem autorizar.
   Isso leva semanas e é independente da publicação nas lojas.
3. **Credencial de push no EAS** (FCM para Android, APNs para iOS). Sem ela
   `getExpoPushTokenAsync` falha e `registrarParaAvisos` devolve `false` em
   silêncio — o modo conectado continua funcionando, só sem o aviso.

### Por que não há deep link de volta do OAuth

O redirect cai em `/instagram/callback`, no nosso servidor, que é onde o `code`
vira token. O app não participa dessa volta: ele abre o navegador e reconfere as
métricas quando volta ao primeiro plano (`AppState`). Um esquema próprio
registrado na Meta não mudaria nada para quem usa.

### O aviso de queda

O agendador já coleta uma amostra por perfil por dia. Quando a contagem cai,
`avisarSeCaiu` manda um push — e o texto **é sobre número**:

> Você perdeu 3 seguidores
> Sua contagem caiu de 1.359 para 1.356. Para saber quem saiu, importe um arquivo
> novo do Instagram.

A segunda frase não é enfeite: sem ela a pessoa abre o app procurando um nome que
este caminho nunca vai ter. E "@fulano deixou de te seguir" é impossível por dois
motivos somados — o dado não existe aqui, e push atravessa Apple e Google em
claro e aparece na tela de bloqueio.

Não avisa alta. Um app que interrompe com boa notícia todo dia é silenciado, e
junto com ele o aviso que a pessoa queria.

A faixa de silêncio padrão é 22h → 8h, no fuso do aparelho mais recente. Dentro
dela o aviso **não é enviado nem gravado** — gravar queimaria a `dedupe_key` do
dia e o aviso nunca sairia; como o agendador roda de hora em hora, ele volta
depois que a faixa terminar.

As tabelas (`devices`, `notifications`, `notification_prefs`) existem desde a
migração 002. Não houve migração nova.

### A tabela de capacidades

A tela `SobreOArquivoScreen` chegou a mostrar uma tabela vinda de
`MODE_CAPABILITIES` comparando os dois modos. Ela foi removida em 15/08 porque
comparar com um modo que o usuário não tinha como ligar era anunciar recurso
inexistente. Agora que a tela existe, ela pode voltar — mas só depois de o app da
Meta estar aprovado, pelo mesmo motivo.
