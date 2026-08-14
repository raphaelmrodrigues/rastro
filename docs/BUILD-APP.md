# Rodar o Rastro num celular

Três caminhos, do mais rápido ao mais definitivo. O primeiro não gera arquivo
nenhum e funciona em cinco minutos; os outros produzem um app instalado de
verdade.

Todos os comandos rodam de dentro de `packages/app`.

---

## 1. Expo Go — sem build, hoje, iPhone e Android

O jeito de ver o app rodando no aparelho agora. Não gera `.apk` nem `.ipa`: o
Expo Go é um app hospedeiro que baixa o seu JavaScript e executa.

```bash
cd packages/app
npx expo start
```

Aparece um QR code no terminal.

- **Android:** instale o Expo Go da Play Store e escaneie o QR pelo próprio app.
- **iPhone:** instale o Expo Go da App Store e escaneie o QR **pela câmera** do
  sistema.

O celular e o computador precisam estar na mesma rede Wi-Fi. Se a rede bloquear
a conexão direta (Wi-Fi de empresa, rede de visitante), use `npx expo start
--tunnel`, que passa por um túnel externo e é mais lento porém quase sempre
funciona.

**Vale saber:** todas as bibliotecas nativas do Rastro (`expo-file-system`,
`expo-document-picker`, `expo-secure-store`, `react-native-svg`) já vêm dentro do
Expo Go, então o app funciona inteiro. A única limitação é notificação push
remota, que o Expo Go não suporta desde o SDK 53 — e ainda não implementamos push
de qualquer forma.

O app aponta para `https://rastro.urlsnapshot.com` por padrão. Para testar contra
o servidor local, crie `packages/app/.env` com o IP da sua máquina na rede (não
`localhost`, que no celular aponta para o próprio celular):

```
EXPO_PUBLIC_API_URL=http://192.168.0.10:4891
```

---

## 2. APK do Android — arquivo instalável

Isto é o que você descreveu: um `.apk` que instala direto, sem passar pela Play
Store.

```bash
cd packages/app
npx eas-cli login          # sua conta Expo, gratuita
npx eas-cli init           # só na primeira vez: cria o projeto e grava o id no app.json
npx eas-cli build --platform android --profile preview
```

O build roda nos servidores da Expo (a fila gratuita costuma levar de 10 a 30
minutos). No fim o terminal imprime um link — abra esse link **no celular**,
baixe e instale. O Android vai pedir para autorizar "instalar de fonte
desconhecida"; é esperado.

O perfil `preview` está configurado em `eas.json` com `buildType: apk`
justamente por causa disso. O perfil `production` gera `.aab`, que é o formato
que a Play Store exige e que **não** instala direto no aparelho.

Assinatura: na primeira vez o EAS pergunta se pode gerar a keystore por você.
Aceite — ele guarda e reusa. Guardar a keystore importa: é ela que permite
publicar atualizações do mesmo app depois.

---

## 3. iPhone — a resposta curta é: não existe APK no iOS

O iOS não tem equivalente ao APK. A Apple exige que todo app instalado esteja
assinado por um certificado ligado a uma conta de desenvolvedor, e o aparelho
recusa qualquer coisa fora disso. Não é limitação do Expo; é da plataforma.

As opções reais, em ordem de custo:

### a) Expo Go — grátis, funciona hoje
É a opção 1 acima. Para desenvolver e testar o Rastro no seu iPhone, resolve.

### b) Conta Apple gratuita + Xcode — grátis, exige um Mac, expira em 7 dias
Com um Apple ID comum, o Xcode assina e instala o app no seu iPhone ligado por
cabo. O app para de abrir depois de **7 dias** e precisa ser reinstalado. Exige
um Mac; não há como fazer isso do Windows.

```bash
cd packages/app
npx expo prebuild --platform ios      # gera a pasta ios/
npx expo run:ios --device             # escolha o iPhone conectado
```

### c) Apple Developer Program — USD 99/ano, é o caminho de verdade
Com a conta paga, o EAS Build compila na nuvem (nenhum Mac necessário) e a
distribuição interna dá um link igual ao do Android:

```bash
npx eas-cli device:create                                   # registra o UDID do iPhone
npx eas-cli build --platform ios --profile preview
```

O link abre no Safari do iPhone e instala. O app dura um ano, não sete dias.
É também o mesmo caminho para TestFlight e, depois, para a App Store.

**Resumo prático:** para testar agora no seu iPhone, use o Expo Go. A assinatura
de USD 99/ano só se torna necessária quando você quiser instalar em aparelhos de
amigos sem o Expo Go, ou publicar.

---

## O que já está configurado

- `app.json` — identificadores `com.urlsnapshot.rastro` nas duas plataformas.
  Eles podem ser trocados a qualquer momento **até a primeira publicação**;
  depois disso ficam permanentes, porque a loja identifica o app por eles.
- `eas.json` — três perfis: `development` (com dev client, apontando para a API
  local), `preview` (APK / distribuição interna) e `production` (AAB, com
  versionamento automático).
- `eas-build-post-install` em `packages/app/package.json` — compila o
  `@rastro/core` no servidor de build. **Não remova.** O EAS clona apenas os
  arquivos versionados, e `packages/core/dist` está no `.gitignore`; sem esse
  hook o bundle não encontra o core e o build falha com um erro de resolução de
  módulo que não diz o que houve.

## O que ainda falta antes de publicar

- **Ícone e splash screen.** Não existe `packages/app/assets`, então o app usa o
  ícone padrão do Expo. Irrelevante para testar, obrigatório para a loja.
- Política de privacidade e os demais itens do Marco 4 no `ROADMAP.md`.
