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

O core trata isso em três camadas:

1. `detectDataWindow()` extrai a janela declarada (`htmlExport.ts`);
2. `parseExport()` emite o warning `PARTIAL_EXPORT` e preenche `Snapshot.dataWindow`;
3. `diffSnapshots()` compara as janelas dos dois snapshots e devolve
   `reliability.level = 'suspect'` quando elas não batem — a UI mostra o aviso
   antes da lista, não como rodapé.

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
