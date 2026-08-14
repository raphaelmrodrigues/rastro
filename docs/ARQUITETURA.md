# Arquitetura

## Decisão 1 — o `core` é puro

`packages/core` não importa `fs`, não faz rede, não conhece React nem banco.
Recebe objetos, devolve objetos.

Motivo: a mesma lógica precisa rodar em dois lugares.

- **No dispositivo**, para o modo privado — o zip é lido com JSZip e nada sai do celular.
- **No servidor**, para quem quer histórico sincronizado entre aparelhos.

Se o parsing dependesse de `fs`, seria preciso duplicar a lógica, e as duas cópias
divergiriam. Mantenha a pureza.

## Decisão 2 — snapshots, não estado mutável

Não guardamos "a lista atual de seguidores" que vai sendo atualizada. Guardamos uma
sequência imutável de fotografias. Todo relatório é uma função dessa sequência.

Motivo: bugs de diff são recuperáveis. Se a lógica de comparação melhorar (por exemplo,
uma detecção de rename mais esperta), basta recalcular sobre os snapshots antigos. Com
estado mutável, um bug corrompe o histórico para sempre.

## Decisão 3 — precisão é um campo de dado, não um detalhe de UI

Todo evento carrega `precision: 'exact' | 'window'`. Isso atravessa o core, o banco e a
interface.

Motivo: entrada de seguidor tem data exata (vem do export). Saída não — só sabemos a
janela entre dois imports. Mostrar as duas iguais é mentir para o usuário, e ele
descobre. A honestidade sobre a incerteza é parte do posicionamento do produto, então
ela é modelada nos tipos, não deixada a critério de quem escreve a tela.

## Decisão 4 — o `@` é a identidade, com todas as consequências

O export não traz o ID numérico da conta. Isso significa que renomeação é
indistinguível de saída + entrada, no caso geral.

A heurística em `core/diff.ts` casa saídas e entradas pelo `since` (o momento em que a
pessoa passou a seguir), que o Instagram preserva ao renomear. Confiança alta colapsa o
par; confiança média marca o evento e deixa o usuário decidir.

Não é perfeito. É melhor do que o resto do nicho, que reporta toda renomeação como
unfollow sem avisar.

## Decisão 5 — falhar o import é melhor que salvar lixo

Um snapshot sem seguidores, se persistido, faz o diff seguinte reportar a base inteira
como perdida. `isSnapshotUsable()` existe para barrar isso antes da persistência.

Vale a regra geral: em caso de dúvida sobre a integridade de um import, rejeite com uma
mensagem que explique o que fazer. Nunca corrompa o histórico.

## Decisão 6 — desconfiança é um campo do diff, não um julgamento da tela

`SnapshotDiff.reliability` diz se aquele par de snapshots é comparável. Hoje detecta
três coisas: janelas de dados diferentes entre os dois exports, perda de uma fatia
grande da base de uma vez, e ausência de janela em um dos lados.

Motivo: a falha mais destrutiva do produto não é errar um nome — é comparar dois
exports incomparáveis (um pedido com período limitado, outro completo; ou um a que
faltou um `followers_2`) e imprimir uma lista de pessoas que "deixaram de seguir" e
não deixaram. Um relatório assim é pior que relatório nenhum, porque o usuário age
em cima dele: manda mensagem, deixa de seguir de volta, se magoa.

Fica no core, e não na UI, porque a mesma verificação precisa valer no app e no
servidor, e porque decidir "isso está confiável" é regra de domínio, não decoração.

## Decisão 7 — dois formatos de export, um parser

O Instagram entrega o export em JSON ou HTML. A documentação manda pedir JSON, e o
JSON é melhor. Mas o usuário real traz HTML, porque é o que o app dele ofereceu — e
recusar o arquivo depois de ele esperar 48h é perder o usuário por preciosismo.

O HTML é lido em `core/htmlExport.ts`, que normaliza para a mesma forma do JSON antes
de chegar em `parseExport`. Duas escolhas deliberadas ali:

- **Varredura por tokens, não por seletor CSS.** As classes do export são ofuscadas
  (`_a6-p`) e mudam entre versões. O parser procura estrutura semântica — um @, uma
  data — e casa os dois na ordem em que aparecem. Layout novo com a mesma semântica
  continua funcionando.
- **O fuso é derivado, não assumido.** O cabeçalho traz o mesmo instante em ISO e em
  texto local; a diferença entre eles é o offset do arquivo. Sem isso as datas saem
  algumas horas deslocadas — no export de teste, sete.

## Decisão 8 — o modo conectado complementa, nunca substitui

O app tem um segundo modo, opcional, que lê métricas da API oficial da Meta sem
arquivo nenhum. Ele responde *quantos*; nunca *quem*, porque a API oficial não expõe
a lista de seguidores para ninguém.

A tentação de "resolver" isso com API privada existe e é permanente. Ela custa a
conta do usuário, não a nossa. `MODE_CAPABILITIES`, no core, é a fronteira escrita em
código e coberta por teste. Detalhes em `docs/MODO-CONECTADO.md`.

Só um arquivo do projeto fala com o Instagram: `api/src/lib/instagramApi.ts`. Se
algum dia aparecer um segundo, é sinal de que alguém abriu uma porta que não devia.

## Fluxo do import

```
usuário baixa .zip do Instagram
        ↓
filtra e extrai só as listas de conexões        (nunca descompactar mídia:
        ↓                                        o export completo passa de 100 MB)
core.parseExport()  →  Snapshot + warnings      (JSON ou HTML)
        ↓
core.isSnapshotUsable()  →  rejeita se vazio
        ↓
persiste snapshot + entries
        ↓
core.diffSnapshots(anterior, novo)  →  eventos + reliability
        ↓
materializa follow_events, descarta o zip
```

## Crescimento da tabela de entries

Uma linha por conta por snapshot. 5.000 seguidores × 24 imports/ano = 120 mil linhas por
perfil por ano. Aceitável no início.

Quando incomodar: manter os N snapshots recentes completos e, para os antigos, guardar só
os `follow_events` derivados e as contagens agregadas, descartando as entries. Os eventos
já bastam para reconstruir a linha do tempo.
