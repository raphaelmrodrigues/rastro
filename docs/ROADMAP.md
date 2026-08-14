# Roadmap

## Marco 0 — o core funciona ✅

- [x] Tipos de domínio
- [x] Parser defensivo do export (JSON **e** HTML)
- [x] Diff com detecção de troca de @
- [x] Estatísticas: safras, crescimento, churn, retenção
- [x] Testes dos casos que quebram o produto (60 testes)
- [x] Rodar contra um export real e corrigir o que divergir

O que o export real revelou, e que o esqueleto não previa:

1. **O export veio em HTML**, não JSON — formato inteiro a mais para suportar.
2. **As datas do HTML não estão no fuso que declaram.** O cabeçalho diz "UTC" e o
   horário está em UTC-7. O parser deriva o offset em vez de assumir.
3. **O export estava limitado a 12 meses.** Isso não traz a base completa de
   seguidores, e comparar com um export completo produziria centenas de unfollows
   falsos. Detectado e sinalizado em três camadas.
4. **A heurística de rename tinha um falso positivo real:** casava qualquer saída
   com qualquer entrada de `since` próximo, o que dispara justamente nas contas com
   picos de crescimento. Agora exige que o "novo" alegue seguir desde antes do
   último import.

## Marco 1 — app local, sem servidor ✅

- [x] Tela de guia do export (`ImportGuideScreen`)
- [x] Seleção do arquivo com `expo-document-picker`
- [x] Leitura do zip com JSZip (`lib/importExport.ts`)
- [x] Persistência local dos snapshots (`lib/storage.ts`)
- [x] Telas: quem saiu, quem entrou, não te seguem de volta, você não segue de
      volta, mútuos, pendentes
- [ ] Notificação local lembrando de reimportar (o painel já mostra o aviso;
      falta agendar com `expo-notifications`)

## Marco 2 — estatísticas ✅ (parcial)

- [x] Distribuição de entrada por mês
- [x] Safras: retenção por mês de entrada
- [x] Limpeza de solicitações pendentes antigas
- [ ] Linha do tempo com trechos tracejados nas janelas de incerteza
      (o elemento "trilha" está definido em `theme.ts` e ainda não foi desenhado)
- [ ] Gráfico de crescimento com `react-native-svg` entre múltiplos imports

## Marco 3 — servidor opcional ✅ (implementado, falta rodar em produção)

- [x] Auth (conta do Rastro, nunca do Instagram)
- [x] Upload e processamento do zip em streaming, com limites de segurança
- [x] Persistência e relatórios (`/snapshots`, `/latest/diff`, `/stats`)
- [x] Exclusão de conta e dos dados
- [ ] Sync de verdade com o app (o app ainda é 100% local; falta o cliente HTTP)
- [ ] Testes de integração da API

## Marco 3b — modo conectado (API oficial) ✅

Responde à pergunta "dá para usar sem baixar o arquivo?". Ver `docs/MODO-CONECTADO.md`.

- [x] OAuth oficial (Business Login for Instagram), token cifrado em repouso
- [x] Amostragem diária de `followers_count` → série histórica
- [x] Métrica `follows_and_unfollows` e demografia agregada
- [x] Tela comparando os dois modos, com o limite escrito
- [ ] Criar o app na Meta e testar o fluxo ponta a ponta com credenciais reais
- [ ] App Review da Meta (necessário para sair do modo de desenvolvimento)

## Marco 4 — publicação

- [ ] Política de privacidade real, escrita antes da submissão
- [ ] Descrição nas lojas usando linguagem precisa, deliberadamente diferente
      da dos apps golpistas do nicho
- [ ] Contas de desenvolvedor: Apple (USD 99/ano) e Google (USD 25 único)
- [ ] Telemetria de falha de parsing, para descobrir cedo quando o Instagram
      mudar o formato do export

## Marco 5 — monetização, se houver tração

- [ ] Assinatura via RevenueCat ou StoreKit/Play Billing direto
- [ ] Definir o que fica no gratuito (ver `PRODUTO.md`)

## Ideias sem prazo

- Detecção de rename assistida pelo usuário ("essa pessoa só mudou de @")
- Múltiplos perfis por conta
- Export do relatório em PDF
- Comparar dois snapshots quaisquer, não só os consecutivos
