# Formato do export de dados do Instagram

> **Aviso:** o Instagram altera esse formato sem aviso prévio e sem versionamento.
> Todo parser deve ser defensivo. Valide contra um export real antes de confiar
> em qualquer coisa abaixo. Trate esta página como mapa, não como contrato.
>
> **Validado contra um export real de agosto de 2026** (conta pessoal em pt-BR,
> formato HTML). O que está marcado como *verificado* foi conferido nesse arquivo.

## Como o usuário obtém o arquivo

App do Instagram → perfil → menu (☰) → Configurações e privacidade → Central de Contas →
Suas informações e permissões → Baixar suas informações.

Ao pedir, escolher:

- **Escopo:** dá para filtrar só "Seguidores e seguindo", o que reduz o zip de
  centenas de MB para kilobytes. O onboarding do app **deve** instruir isso, senão
  o usuário baixa todas as fotos e conversas dele à toa.
- **Período: todo o período.** Este é o passo que mais gente erra, e o mais caro —
  ver a seção "A armadilha do período limitado" abaixo.
- **Formato:** JSON é preferível, HTML funciona. O app lê os dois (ver adiante).

O Instagram processa e envia um e-mail com o link. Pode levar de minutos a ~48h.

## A armadilha do período limitado

*(verificado — o export de teste caiu nela)*

Se o usuário escolher um período em vez de "todo o período", o export **não traz a
base completa de seguidores**: traz só quem entrou dentro da janela. O cabeçalho
declara isso em texto:

```html
<aside role="contentinfo">Gerado por fulano em <time datetime="2026-08-12T05:03Z">…</time>
<div>Contém os dados de <time datetime="2025-08-12T04:52Z">…</time>
     a <time datetime="2026-08-12T04:52Z">…</time> que você solicitou</div></aside>
```

Por que isso é o problema mais grave do produto, e não um detalhe:

- comparar um export de 12 meses com um export completo faz o diff acusar como
  "deixaram de seguir" todo mundo que entrou antes da janela;
- na ordem inversa, inventa centenas de seguidores novos;
- em ambos os casos o app entrega uma lista de nomes **errada**, e o usuário age em
  cima dela.

### Quanto isso custa, em números do arquivo real (21/08/2026)

O mesmo perfil, os mesmos dias, dois pedidos diferentes:

| pedido | seguidores | seguindo | mais antigo |
|---|---|---|---|
| "Todo o período" (JSON, 13 e 21/08) | 1.361 / 1.359 | 1.157 / 1.162 | 27/11/2014 |
| período de 12 meses (HTML, 12/08) | **222** | 1.158 | — |

Duas coisas a notar. A primeira: **1.139 seguidores somem**. A segunda, menos
óbvia e mais perigosa: a lista de *seguindo* veio quase completa no mesmo
arquivo. O recorte não é uniforme, então "as duas listas encolheram junto" não
serve como sinal.

E a data mais antiga do export completo — 27/11/2014 — é exatamente a data de
criação da conta, que está em `signup_details.json`. É isso que torna a
verificação possível sem o cabeçalho do HTML.

### As camadas de defesa

1. `detectDataWindow()` extrai a janela declarada (`htmlExport.ts`) — **só o HTML
   declara período; o JSON não traz essa informação em lugar nenhum**;
2. `parseExport()` emite o warning `PARTIAL_EXPORT` e preenche `Snapshot.dataWindow`;
3. `diffSnapshots()` compara as janelas dos dois snapshots e devolve
   `reliability.level = 'suspect'` quando elas não batem;
4. `checkExport()` (`completeness.ts`, 21/08/2026) **recusa o import** antes de
   ele virar histórico. É a camada que faltava: as três primeiras avisavam depois
   de o arquivo já estar salvo, e um snapshot recortado salvo envenena todos os
   diffs seguintes.

O que `checkExport` bloqueia, e com que evidência:

| código | evidência | severidade |
|---|---|---|
| `FORMAT_HTML` | `snapshot.format` | bloqueia |
| `MISSING_FOLLOWERS` / `MISSING_FOLLOWING` | lista vazia | bloqueia |
| `DECLARED_WINDOW` | cabeçalho do HTML | bloqueia |
| `MASS_LOSS` | queda > 30% de **seguidores** vs. o arquivo anterior | bloqueia ou pergunta |
| `SHALLOW_HISTORY` | lista cobre < 40% da vida da conta | pergunta |
| `CONFIRM_COUNT` | primeiro import, nada com que comparar | pergunta |
| `NO_ACTIVITY` | zero arquivos de conversa | avisa |

`MASS_LOSS` merece duas notas. A primeira: ela compara **seguidores**, nunca
*seguindo*. Deixar de seguir em massa é o que a fila de faxina existe para
organizar, e vigiar `following` faria o app punir quem usou a própria
funcionalidade — no arquivo real, tirar 1.000 dos 1.162 seguidos passa limpo. A
segunda: quando a queda é de seguidores mesmo, ela **bloqueia** se o arquivo não
prova a própria profundidade e apenas **pergunta** se ele alcança a criação da
conta sem declarar recorte. Nesse segundo caso o arquivo demonstrou não ser
truncado, e a queda é evento real — limpeza de contas falsas, conta que viralizou
e esvaziou.

A distinção entre *bloqueia* e *pergunta* não é timidez. Conta antiga que só
engatou seguidores no último ano tem exatamente a mesma forma de um export
truncado, e não há nada no arquivo que as separe — barrá-la seria expulsar
usuário legítimo. Onde a evidência é circunstancial, quem responde é quem conhece
a conta.

### A data de criação da conta

`security_and_login_information/login_and_profile_creation/signup_details.json`,
categoria "Informações de segurança e login" do pedido de export.

Lido por `readAccountCreatedAt()` (`parser.ts`), que pega **o menor epoch
plausível do arquivo** — busca por forma, não por rótulo, porque o rótulo é
localizado ("Hora", "Time") e ainda chega com mojibake no português. Nenhuma
string do arquivo é lida: ele guarda IP, e-mail e telefone.

### Quanto o Instagram realmente demora

`your_instagram_activity/other_activity/your_information_download_requests.json`
registra o pedido e a conclusão. Nos dois pedidos completos do arquivo real:

- 1.483 s (~25 min) para o export completo de 468 MB;
- 1.365 s (~23 min) para o anterior.

As 48 horas são o teto publicado, não a expectativa. Um onboarding que anuncia
48h como regra faz desistir quem teria o arquivo antes do almoço.

## Onde ficam os arquivos dentro do zip

Caminho típico (já variou entre versões — o parser deve procurar por nome de arquivo,
não por caminho fixo). A extensão depende do formato escolhido:

```
connections/followers_and_following/
├── followers_1.json|html                (pode haver followers_2, _3... em contas grandes)
├── following.json|html
├── pending_follow_requests.json|html
├── recent_follow_requests.json|html
├── follow_requests_you've_received.json|html
├── recently_unfollowed_profiles.json|html
├── blocked_profiles.json|html
├── close_friends.json|html
└── restricted_profiles.json|html
```

**Atenção ao `followers_N` paginado.** Contas grandes têm vários arquivos. Se o parser
ler só o primeiro, todo mundo além do primeiro lote vira "deixou de seguir" no
próximo diff — bug catastrófico de confiança. Sempre agregue todos os `followers_*`.
O sintoma disso, quando escapa, é uma perda enorme de uma vez; `diffSnapshots`
também sinaliza esse caso via `reliability`.

---

# Formato JSON

*(verificado contra o export real de 13/08/2026, "todas as informações", todos os anos)*

**São três formas dentro do mesmo arquivo zip, não duas.** O `@` está num lugar
diferente em cada uma. Tratar só a primeira — o que fazíamos até 13/08/2026 —
descartava 1.355 dos 2.717 registros **sem emitir um único aviso**: a tela dizia
"você segue 0 pessoas" com toda a cara de dado correto.

**Forma 1 — array na raiz, com `value`** (`followers_1.json`):

```json
[
  {
    "title": "",
    "media_list_data": [],
    "string_list_data": [
      { "href": "https://www.instagram.com/fulano", "value": "fulano", "timestamp": 1719878400 }
    ]
  }
]
```

**Forma 2 — objeto com chave nomeada, e SEM `value`** (`following.json`):

```json
{
  "relationships_following": [
    {
      "title": "fulano",
      "string_list_data": [
        { "href": "https://www.instagram.com/_u/fulano", "timestamp": 1786576120 }
      ]
    }
  ]
}
```

Aqui o `@` está em `title`, e o link é deep link (`/_u/`). Quem procura só
`string_list_data[0].value` acha `undefined` e perde a lista inteira.

**Forma 3 — rótulo/valor localizado** (`blocked_profiles.json`,
`pending_follow_requests.json`, `recently_unfollowed_profiles.json`,
`restricted_profiles.json`, `recent_follow_requests.json`):

```json
[
  {
    "timestamp": 1740655193,
    "media": [],
    "label_values": [
      { "label": "URL", "value": "" },
      { "label": "Nome", "value": "Sarah Modesto" },
      { "label": "Nome de usuÃ¡rio", "value": "_sarahmodesto_esteticista" }
    ],
    "fbid": "17841403278150691"
  }
]
```

Três detalhes que quebram um parser ingênuo:

1. **Não há `string_list_data`.** O `@` está sob um rótulo em português.
2. **O rótulo vem com mojibake** — `usuÃ¡rio`, UTF-8 lido como Latin-1, gerado
   assim pelo próprio Instagram. Normalizar acento não resolve: `Ã¡` em NFD vira
   `A¡`, não `á`. É preciso reler os bytes como UTF-8 antes (`repairMojibake`
   em `core/src/text.ts`), senão o rótulo nunca casa. Vale para os nomes de
   exibição também.
3. **`URL` costuma vir vazia** (147 de 150 em `pending_follow_requests.json`),
   então não dá para tirar o `@` do link como plano principal.

**Lista de um item só vem como objeto, sem array em volta.** Foi o caso de
`restricted_profiles.json`. Como o objeto tem dois arrays internos (`media` e
`label_values`), a heurística de "um único array = a lista" o interpretava como
três pessoas. Detectar `label_values` + (`fbid` ou `timestamp`) vem antes.

Ordem de busca do `@`, da fonte mais confiável para a menos:
`string_list_data[0].value` → `title` → rótulo de usuário → `@` da URL.

Data: `string_list_data[0].timestamp`, ou o `timestamp` da própria entrada na
forma 3. Sempre epoch em **segundos**, não milissegundos.

Chaves de raiz já vistas na forma 2: `relationships_following`,
`relationships_follow_requests_sent`, `relationships_unfollowed_users`,
`relationships_blocked_users`, `relationships_close_friends`,
`relationships_restricted_users`. O parser não depende do nome — se o objeto tem
exatamente um valor que é array, é ele.

**Regra que ficou:** entrada sem `@` legível nunca é descartada calada. O parser
conta as descartadas por arquivo e emite `ENTRIES_SKIPPED`. Formato novo faz
lista sumir, e lista que some sem aviso é o pior defeito que este produto pode ter.

## O zip do export completo passa de 400 MB

O export "todas as informações" do dono do projeto tem **479 MB** — quase tudo
foto e vídeo. Os dez arquivos que interessam somam menos de 700 KB.

Consequência prática: **não dá para carregar o zip inteiro em memória.** Duas
armadilhas concretas já encontradas:

- `FileReader.readAsDataURL` (o que o `expo-document-picker` usa no web) tenta
  criar uma string base64 de ~639 MB, acima do teto do V8. Falha, e a mensagem
  de erro acusa o arquivo — que estava perfeito. Por isso o app usa um
  `<input type="file">` próprio no navegador e fica com o objeto `File`.
- `JSZip.loadAsync` exige o arquivo todo antes de listar o conteúdo.

O app lê o zip em blocos de 3 MB e descompacta em fluxo (`app/src/lib/zip.ts`),
só dos arquivos que passam no filtro. Medido no export real: **0,3 s e 10 MB de
pico de memória** para os 479 MB.

---

# Formato HTML

*(tudo nesta seção verificado contra o export real)*

O app aceita HTML porque o usuário real traz HTML. Recusar o arquivo depois de ele
ter esperado até 48h pelo download é perder o usuário por preciosismo.

## Três layouts para a mesma informação

O mesmo export usa três estruturas diferentes. As classes CSS são ofuscadas
(`_a6-p`, `_3-94`) e mudam entre versões, então o parser **não** as usa: ele varre o
documento como um fluxo de tokens ("achei um @", "achei uma data") e casa cada @ com
a data seguinte.

**1. Lista com link** — `followers_1.html`:

```html
<a target="_blank" href="https://www.instagram.com/fulano">fulano</a>
<div>ago 10, 2026 4:38 da manhã</div>
```

**2. Lista com título** — `following.html`. O @ aparece duas vezes (no `<h2>` e no
link), e o link é deep link com `/_u/`:

```html
<h2>fulano</h2>
<a href="https://www.instagram.com/_u/fulano">https://www.instagram.com/_u/fulano</a>
<div>ago 11, 2026 1:07 da manhã</div>
```

**3. Tabela rotulada** — pedidos pendentes, bloqueados, deixou de seguir. Sem link, e
com nome de exibição:

```html
<td>Nome</td><td>Gabrielle Chaime</td>
<td>Nome de usuário</td><td>gabriellechaime</td>
<div class="_3-94 _a6-o">ago 07, 2026 7:31 da tarde/noite</div>
```

Só o HTML traz o **nome de exibição** — o JSON não tem. Ele é útil na UI, mas nunca
é identidade: duas pessoas podem ter o mesmo nome, e ele muda sem aviso.

## As datas mentem sobre o fuso

Este é o detalhe mais fácil de errar em silêncio. O cabeçalho traz o mesmo instante
duas vezes, uma para máquina e outra para humano:

```html
<time datetime="2026-08-12T05:03Z">Terça-feira, 11 de agosto de 2026 às 22:03 UTC</time>
```

`05:03Z` e `22:03` são o mesmo momento — logo, o texto está em **UTC-7**, apesar de
dizer "UTC". O rótulo está errado no arquivo do Instagram.

As datas das linhas de dados (`ago 10, 2026 4:38 da manhã`) estão nesse mesmo fuso
não declarado. `detectTimezoneOffset()` deriva o offset comparando o `datetime` com o
texto, e o aplica a todas as datas do arquivo. **Sem isso, todo horário sai 7 horas
deslocado** e um seguidor que entrou às 21h de segunda aparece como terça.

Quando o cabeçalho não permite derivar, o parser emite `AMBIGUOUS_TIMEZONE` e usa o
fallback informado por quem chamou (o app passa o fuso do aparelho).

## Formato das datas

`mmm DD, YYYY H:MM <período do dia>`, relógio de 12 horas. O português do Instagram
escreve `da manhã` e `da tarde/noite` — uma string só para tarde e noite. O parser
cobre pt, en e es; idioma desconhecido não quebra o import, só deixa a conta sem
data (warning `UNPARSEABLE_DATE`).

Cuidado com 12h: `12:30 da manhã` é 00:30, `12:30 da tarde/noite` é 12:30.

## Precisão

O HTML tem precisão de **minuto** (o JSON tem segundo) e depende do fuso derivado.
`Snapshot.format` registra de onde veio cada snapshot, para a UI calibrar o que
promete.

---

## O problema do username como identidade

O export **não traz o user ID numérico**, só o `@`. Se alguém trocar de `@` entre dois
snapshots, isso é indistinguível de "saiu e entrou outra pessoa" no caso geral.

`detectRenames()` em `diff.ts` casa saídas e entradas por duas condições:

1. os dois lados têm praticamente o mesmo `since` — o Instagram preserva a data em
   que a pessoa passou a seguir quando ela renomeia;
2. o `since` do lado que entrou é **anterior ao import passado**.

A condição 2 não é opcional. Sem ela, quando um post rende bem e dezenas de pessoas
seguem no mesmo minuto, qualquer saída vizinha no tempo vira um "trocou de @"
inventado — e um unfollow verdadeiro some da lista.

Confiança alta colapsa o par; confiança média marca o evento e deixa o usuário decidir.

## Timestamps: o que é exato e o que é aproximado

| Evento | Precisão | Origem |
|---|---|---|
| Alguém começou a te seguir | **exata** | `timestamp` / data no `followers_*` |
| Você começou a seguir alguém | **exata** | `timestamp` / data no `following` |
| Alguém deixou de te seguir | **janela entre 2 snapshots** | inferido por diff |
| Você deixou de seguir alguém | **janela** (ou lista `recently_unfollowed`) | diff |

A UI precisa deixar essa diferença clara. Mostrar "saiu em 12/03 às 14h" quando na
verdade foi "entre 01/03 e 15/03" é mentira, e o usuário descobre.

---

# Mensagens: o que dá e o que não dá para fazer

Medido no export real de 13/08/2026 — 1.583 conversas, 54.100 mensagens.

## Forma do arquivo

`your_instagram_activity/messages/inbox/<pasta>/message_N.json`:

```jsonc
{
  "participants": [{ "name": "Ana Souza" }, { "name": "Raphael" }],
  "title": "Ana Souza",
  "thread_path": "inbox/anasouza_17841…",
  "is_still_participant": true,
  "messages": [
    {
      "sender_name": "Ana Souza",
      "timestamp_ms": 1755000000000,
      "content": "texto, quando existe",
      "reactions": [{ "reaction": "<mojibake>", "actor": "Raphael" }]
    }
  ]
}
```

Frequência das chaves de mensagem, em 54.100 mensagens:

| Chave | Vezes | Observação |
|---|---|---|
| `sender_name`, `timestamp_ms` | 54.100 | sempre presentes |
| `content` | 46.345 | **falta em ~14%** — o resto é mídia |
| `share` | 9.483 | post ou reel encaminhado |
| `reactions` | 2.815 | ver abaixo |
| `audio_files` | 622 | |
| `photos` | 237 | |
| `call_duration` | 40 | |
| `videos` | 23 | |

Uma prévia de conversa que só olhe `content` mostra vazio em 14% das mensagens.
Por isso `activity.ts` traduz a mídia num rótulo (`kind`).

## Reações não são mensagens

A reação vive **dentro** da mensagem que ela responde, em `reactions[]`, com
`{ reaction, actor }` e às vezes `timestamp` (1.859 das 2.875 reações o trazem —
não conte com ele).

Consequência para "você não respondeu": responder com ❤️ não cria mensagem
nenhuma, então olhar só `sender_name` da última mensagem acusa como não
respondida uma conversa que foi respondida. No export do dono isso eram **44
conversas** cobradas à toa. Ver `awaitingYou` em `core/src/activity.ts`.

O emoji vem com o mojibake de sempre (UTF-8 lido como Latin-1): `❤️` chega como
os seis bytes `E2 9D A4 EF B8 8F`, um caractere por byte. `repairMojibake`
resolve.

## Não existe ligação entre conversa e perfil

Este é um beco sem saída, e é bom que esteja escrito para ninguém tentar de novo:

- O arquivo da conversa **não traz o @** de ninguém. Só `sender_name` e `title`,
  que são nome de exibição.
- O nome da pasta **não é o @**. Em **1.480 de 1.573** conversas ele é o `title`
  achatado — sem acento, sem espaço, minúsculo. Só 49 pastas coincidem com um @
  conhecido, e coincidem porque aquelas pessoas usam o @ como nome de exibição.
- As listas de seguidores do export JSON vêm **sem nome de exibição**: 0 de 1.361
  contas têm o campo preenchido.

Ou seja: um lado só tem nome, o outro só tem @, e não há coluna em comum. Casar
por forma normalizada (ignorar pontos, por exemplo) não resolve — produz palpite
sobre nome de exibição e manda o usuário ao perfil de um estranho. Foi tentado e
desfeito em 20/08/2026, com ganho de 9 links, todos duvidosos.

A saída que o app usa é abrir a **busca** do Instagram pelo nome, em vez de fingir
que sabe o perfil.

## Não existe status de leitura. Em lugar nenhum.

*(varrido em 21/08/2026, no export completo de 468 MB)*

Foi pedido "quero as conversas que eu não visualizei". A resposta é não, e é
definitiva — não é limitação do parser.

As chaves de mensagem, em 600 conversas lidas, são exatamente estas:

```
sender_name, timestamp_ms, is_geoblocked_for_viewer,
is_unsent_image_by_messenger_kid_parent, content, share,
reactions, audio_files, photos, call_duration, videos
```

E as da raiz da conversa:

```
participants, messages, title, is_still_participant,
thread_path, magic_words, joinable_mode, image
```

Nenhum campo de leitura. `is_geoblocked_for_viewer` é bloqueio geográfico, não
"visto". A varredura por `read|seen|unread|view|opened|delivered` em todos os
JSON do zip só devolve arquivos sobre o que **você** consumiu — `stories_viewed`,
`posts_viewed`, `ads_viewed`, `recently_viewed_items` — nada sobre DM.

O Instagram sabe (é o "visto" azul) e não exporta. A API oficial não dá acesso a
DM de conta pessoal. Não há fonte legítima.

### As duas aproximações que existem

| lista | critério | quantas |
|---|---|---|
| "Você não respondeu" | última mensagem não é sua e você não reagiu | 644 |
| **"Você nunca respondeu"** | você nunca mandou nada nessa conversa | **66** |
| **"Pedidos de mensagem"** | veio de `messages/message_requests/` | **39** |

Das 39 solicitações, **38 nunca foram respondidas** — o que confirma a intuição:
a caixa de solicitações é onde mora a mensagem que ninguém abriu.

`neverReplied` sai de `ConversationDraft.senders`, o conjunto de remetentes
distintos da conversa. Fica no rascunho porque "quem é você" só se descobre
olhando todas as conversas juntas, e voltar às 54 mil mensagens depois custaria
uma segunda passagem pelo zip.

## Duas caixas, e um arquivo com nome truncado

`messages/` tem `inbox/` (4.018 arquivos) e `message_requests/` (41). Até
21/08/2026 o app lia só o primeiro, e as solicitações não existiam para ele.

E o padrão antigo de nome — `message_\d+\.json` — descartava em silêncio uma
conversa real: quando o nome da pasta fica longo demais, o Instagram trunca o
caminho inteiro e o arquivo chega como `messa.json`. Acontece uma vez no export
do dono. Dentro da pasta de uma conversa só existem os JSON dela e a mídia, então
`CONVERSA` hoje aceita qualquer `.json` ali.
