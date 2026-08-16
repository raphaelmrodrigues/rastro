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

**Estado em 15/08/2026: o modo conectado existe só no servidor.** As rotas, o OAuth,
a cifragem do token e o amostrador diário estão implementados e testados, mas o app
não tem nenhuma tela que os acione — não há botão "conectar" em lugar nenhum, e as
variáveis `INSTAGRAM_APP_*` não estão configuradas em produção, então as rotas
respondem 503.

A tela `SobreOArquivoScreen` chegou a mostrar uma tabela vinda de
`MODE_CAPABILITIES` comparando os dois modos. Ela foi removida: comparar com um modo
que o usuário não tem como ligar é anunciar recurso que não existe. `MODE_CAPABILITIES`
continua no core, à espera da interface.
