# Publicar o Rastro na Play Store

Este documento começa onde o `BUILD-APP.md` termina. Lá está como gerar um APK e
instalar no celular; aqui está o que fazer com a conta da Play Console já
verificada, na ordem que evita retrabalho.

A ordem importa por um motivo concreto: **o requisito dos 14 dias de teste
fechado corre em paralelo com tudo o mais**, então ele precisa começar cedo, e
não depois de a ficha da loja estar pronta.

---

## Fase 1 — o APK no seu celular

Antes de qualquer coisa da loja. Nada do que está escrito abaixo vale se o app
não abrir num aparelho de verdade — e até hoje ele nunca abriu.

```bash
cd packages/app
npx eas-cli login                                        # sua conta Expo, gratuita
npx eas-cli init                                         # grava o projectId no app.json
npx eas-cli build --platform android --profile preview   # APK, 10–30 min na fila gratuita
```

Na primeira vez o EAS pergunta se pode gerar a keystore. **Aceite, e não a
perca.** É ela que assina o app; sem ela, uma atualização futura vira um app
diferente aos olhos da Play Store e ninguém consegue atualizar. O EAS guarda por
padrão — `npx eas-cli credentials` mostra e baixa.

O perfil `preview` aponta para `https://rastro.urlsnapshot.com`, a API de
produção. É o que se quer aqui: testar o caminho real.

### O que a primeira rodada achou (19/08/2026, Galaxy A51)

Três defeitos, os três consertados — e os três invisíveis no navegador:

- o import não fazia nada ao escolher o arquivo (cópia de 479 MB em silêncio, e
  a falha virava rejeição não tratada);
- a barra de navegação do Android cobria o botão "Escolher arquivo";
- a primeira tela era uma parede de texto.

O conserto da área segura trouxe `react-native-safe-area-context`, que é um
**módulo nativo**: o APK que já está no aparelho não o contém. Gere um build
novo antes de repetir os testes — recarregar o JavaScript não basta.

### O que testar, porque nunca rodou fora do navegador

O código tem ramos nativos que o `expo start --web` nunca executou. Estes:

- [ ] **Import do arquivo** pelo seletor de documentos do Android (SAF), não pelo
      `<input type=file>` do navegador — incluindo um arquivo guardado no Google
      Drive, que é o caso em que a abertura direta pode falhar e cair no fallback
- [ ] **Boas-vindas**: os quatro slides no gesto e no botão, e não voltar a
      aparecer depois de concluídos
- [ ] **Import do export completo** — o de verdade, ~479 MB, 1582 conversas. É o
      teste que mais pode falhar: memória, tempo, o descompactador em streaming
- [ ] **Apagar o arquivo baixado** depois do import, quando o app oferece
- [ ] **Notificações locais** — ative o lembrete, confirme que o Android 13+ pede
      a permissão, e que a notificação chega no horário
- [ ] **Botão voltar do Android** em cada tela empilhada
- [ ] **SecureStore** — criar conta, fechar o app pela lista de recentes, reabrir
      e continuar logado
- [ ] **Sem rede** — modo avião: as telas locais precisam abrir mesmo assim
- [ ] **Convite de conta** aparecendo depois do primeiro import, e sumindo depois
      de criar a conta

Falha de parsing e crash chegam sozinhos no painel `/admin` — é para isso que a
telemetria existe. Vale abrir o painel depois da bateria de testes.

---

## Fase 2 — teste interno na Play Console

O **teste interno** é a faixa mais rápida: até 100 pessoas, disponível em
minutos, sem revisão demorada. É onde o app deve morar enquanto você conserta o
que a Fase 1 achou.

```bash
npx eas-cli build --platform android --profile production   # AAB, que é o que a loja aceita
```

Depois, na Play Console: **Testes → Teste interno → Criar versão**, e suba o
`.aab`. O `eas submit` automatiza isso, mas exige uma conta de serviço do Google
Cloud; para as primeiras versões o upload manual é mais simples do que
configurar a chave.

Nesta fase a Play Console já vai cobrar o **conteúdo do app**: classificação
indicativa, público-alvo, anúncios (responder **não**), e a **Segurança dos
dados**. Vale preencher agora, porque nada avança sem isso.

### Segurança dos dados — o que declarar

Responda com o que o app realmente faz, que é pouco:

| Pergunta | Resposta |
|---|---|
| Coleta dados? | Sim |
| E-mail | Coletado, ligado à identidade, para gerenciamento da conta. Opcional? **Sim** |
| Arquivos e documentos | Processados no aparelho; só o resultado sobe, e só com conta |
| Lista de contatos / mensagens | **Não.** O app filtra por nome de arquivo antes de descompactar: DMs e histórico de acesso nunca são lidos |
| Compartilha com terceiros? | Não |
| Trânsito criptografado? | Sim |
| Usuário pode pedir exclusão? | Sim — e existe a tela |

O item "o usuário pode solicitar a exclusão dos dados" exige uma **URL pública**
explicando como. A política de privacidade serve, desde que descreva o caminho.

---

## Fase 3 — teste fechado, e o relógio de 14 dias

**Confira na sua Play Console, em "Acesso à produção", qual regra se aplica à sua
conta.** Para contas de desenvolvedor **pessoais** (não empresa) criadas depois
de novembro de 2023, o Google exige um **teste fechado com no mínimo 12
testadores inscritos, ativos por 14 dias consecutivos**, antes de liberar o
pedido de acesso à produção.

Isso significa, na prática:

- não são 12 instalações; são 12 contas Google **inscritas e mantidas** no teste
  durante duas semanas seguidas — alguém que sai no meio zera a contagem;
- o prazo é de calendário. Se você quer publicar daqui a três semanas, o teste
  fechado precisa começar **nesta semana**;
- juntar 12 pessoas leva mais tempo do que parece. Comece a lista agora: você
  precisa do e-mail da conta Google de cada uma.

O caminho é **Testes → Teste fechado → criar uma lista de e-mails**, subir o
mesmo AAB, e mandar o link de opt-in para as 12.

Vantagem lateral: são 12 pessoas passando pelo onboarding real, incluindo a
espera do export do Instagram. É o único jeito de descobrir onde o funil quebra
antes de o app estar público.

---

## Fase 4 — ficha da loja

O que a página do app precisa. Escreva antes de precisar dela.

- **Nome:** Rastro (30 caracteres no máximo)
- **Descrição curta:** 80 caracteres. É o que aparece na busca
- **Descrição completa:** 4000 caracteres
- **Ícone:** 512×512 PNG — já existe em `packages/app/assets/icon.png` (roxo,
  regenerado por `npm run icones --workspace @rastro/app`)
- **Gráfico de destaque:** 1024×500 — **ainda não existe, precisa ser feito**
- **Screenshots:** mínimo 2, recomendado 4 a 8, de celular. Tire do aparelho
  depois da Fase 1, com dados de verdade
- **Política de privacidade:** a URL que você já criou

### Sobre o texto: a diferença que protege o app

O nicho é dominado por apps que prometem "quem viu seu perfil" e pedem a senha do
Instagram. A descrição precisa se separar deles de forma explícita, por dois
motivos que se somam: é o argumento de venda real, e é o que evita que a revisão
trate o Rastro como mais um do mesmo.

O que dizer, e que os concorrentes não podem dizer:

- não pedimos a senha do Instagram, e não existe campo para ela;
- o app lê o arquivo de dados que o próprio Instagram entrega a você;
- sua conta não corre risco de bloqueio, porque nada acessa o Instagram em seu
  nome.

O que **não** prometer, nunca, nem de forma indireta:

- quem viu seu perfil — o dado não existe, e a promessa é remoção certa;
- aviso no momento em que alguém deixa de seguir — o app compara arquivos, não
  observa em tempo real;
- deixar de seguir em massa — o app é somente leitura (regra 4 do `CLAUDE.md`).

---

## Fase 5 — produção

Com os 14 dias cumpridos e o conteúdo do app preenchido, o botão de solicitar
acesso à produção aparece. A primeira revisão de um desenvolvedor novo costuma
ser a mais lenta — dias, não horas.

Depois disso, `npx eas-cli build --profile production` e uma nova versão na
faixa de produção.

---

## Pendências que bloqueiam, e onde estão

- **`ADMIN_EMAILS` no Dokploy**, seguido de redeploy. Sem isso o painel `/admin`
  responde 404 e a migração 004 (telemetria) não roda — ou seja, você fica sem
  ver os erros que a Fase 1 gerar.
- **`JWT_SECRET` e `TOKEN_ENCRYPTION_KEY`** ainda são os de desenvolvimento.
  Trocar antes de haver usuário real, porque trocar depois desloga todo mundo.
- **Gráfico de destaque 1024×500** — não existe.
- **Screenshots** — só dá para tirar depois da Fase 1.
- **`AtualizarScreen.tsx`** tem um ID falso da App Store (`id0000000000`). Não
  afeta Android; corrigir quando houver iOS.
