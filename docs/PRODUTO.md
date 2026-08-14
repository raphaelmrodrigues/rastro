# Rastro — definição de produto

## Posicionamento

O app de acompanhamento de seguidores que **não pede sua senha**.

O nicho inteiro é dominado por apps que fazem login na conta do usuário e o queimam.
O diferencial do Rastro não é uma feature — é não colocar a conta do cliente em risco,
e ser honesto sobre o que dá e o que não dá para saber.

## Público

Pessoas que acompanham a própria rede: criadores pequenos, contas pessoais ativas,
donos de negócio local. Não é ferramenta de growth hacking nem de automação.

## O que o app faz

### Núcleo (v1)

- **Deixaram de seguir** — quem saiu, com a janela de tempo em que aconteceu
- **Novos seguidores** — quem entrou, com data exata
- **Não te seguem de volta** — você segue, a pessoa não
- **Você não segue de volta** — a pessoa segue, você não
- **Seguidores mútuos** — a base real da rede
- **Solicitações pendentes** — pedidos que você enviou e nunca foram aceitos
  (útil e quase ninguém mostra: dá para limpar pedidos parados há anos)

### Estatísticas (v1)

- Crescimento líquido por período (entradas − saídas)
- Taxa de churn: % de seguidores perdidos sobre a base
- Retenção por safra: dos que te seguiram em janeiro, quantos ainda estão aqui
- Seguidores mais antigos — quem está com você desde o começo
- Distribuição de entrada ao longo do tempo (identifica picos: qual post/mês te trouxe gente)
- Razão seguidores/seguindo ao longo do tempo

### Modo conectado (opcional, complementar)

Para quem tem conta profissional, o app também lê a **API oficial** da Meta, sem
arquivo e sem espera: contagem de seguidores atualizada todo dia, quantos entraram e
saíram por período, e a demografia do público.

O limite, dito na própria tela: a API oficial **não expõe a lista de seguidores**.
O modo conectado responde *quantos*, nunca *quem*. Quem saiu, nominalmente, continua
vindo só do import. Detalhes e justificativa em `docs/MODO-CONECTADO.md`.

Os dois modos existem porque falham em pontos opostos: o import tem nomes e histórico
mas depende de um processo chato; a API é automática mas é anônima e não tem passado.

### Diferenciais planejados

1. **Detecção de troca de @** — não reportar renomeação como unfollow (ver
   `EXPORT-INSTAGRAM.md`). Concorrentes erram isso silenciosamente.
2. **Modo 100% offline** — processar o zip no dispositivo, nada sai do celular.
   Sync com servidor vira opt-in para quem quer histórico entre aparelhos.
3. **Linha do tempo honesta** — eventos exatos e eventos aproximados visualmente
   distintos. Nunca fingir precisão que não temos.
4. **Lembrete de import** — notificação local ("faz 15 dias do último import") com o
   passo a passo. A fricção do export é o maior inimigo da retenção do produto.
5. **Safras (cohorts)** — agrupar seguidores por mês de entrada e mostrar quais safras
   ficam e quais evaporam. Ninguém no nicho faz isso.
6. **Aviso de import incompleto** — se o export foi pedido com período limitado, ou
   se faltou um arquivo de seguidores paginado, a comparação sai errada. O app detecta
   e avisa antes de mostrar a lista, em vez de imprimir nomes falsos. É o erro mais
   caro do nicho e ninguém trata.

## Não-objetivos (explícitos e permanentes)

| Não faremos | Por quê |
|---|---|
| "Quem viu seu perfil" | O dado não existe. Nenhuma fonte legítima o expõe. É o golpe padrão do nicho. |
| Login com senha do Instagram | Viola os Termos de Uso e queima a conta do cliente. |
| Unfollow em massa / automação | Viola os Termos e gera bloqueio de ações. |
| "Stalkers" / "admiradores secretos" | Mesma categoria de invenção do item 1. |
| Comprar/entregar seguidores | Fora do escopo e do que o produto defende. |
| Listar seguidores sem o export | A API oficial não expõe isso. Só dá com API privada, que bloqueia a conta do cliente. Ver `MODO-CONECTADO.md`. |

Se um concorrente anuncia qualquer item dessa tabela, ele está mentindo ou queimando
contas. Isso é argumento de marketing nosso, não uma feature a copiar.

## Monetização (a validar)

Grátis: import manual, comparação entre os 2 últimos snapshots, listas básicas.

Pago (assinatura): histórico ilimitado de snapshots, estatísticas de safra e retenção,
exportação de relatórios, múltiplas contas, sync entre dispositivos.

Cuidado legal para a fase paga: revisar a política das lojas sobre apps que processam
dados de plataformas de terceiros, e escrever política de privacidade real antes de
qualquer submissão. Não é opcional — é requisito de publicação.

## Riscos conhecidos

- **Fricção do export.** É o risco número um. O usuário precisa fazer um processo chato
  no Instagram a cada atualização. Todo o onboarding existe para amortecer isso.
- **Mudança de formato do export.** O parser precisa degradar com elegância, e o app
  precisa de telemetria de falha de parsing para você descobrir cedo.
- **Política das lojas.** Descrever o app com precisão na listagem. Não usar as palavras
  que os apps golpistas usam, justamente para não ser classificado junto com eles.
