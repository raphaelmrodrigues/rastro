# Rastro

Acompanhamento de seguidores do Instagram que **não pede sua senha**.

O app trabalha sobre o arquivo de exportação de dados que o próprio usuário solicita ao
Instagram. Não faz login, não usa API privada, não automatiza nada na conta de ninguém.
É essa restrição que permite o produto existir sem queimar a conta de quem o usa.

## Estado

O `core` está completo e validado contra um export real: parser (JSON **e** HTML),
diff com detecção de troca de @, estatísticas e 60 testes. A `api` está implementada
(upload em streaming, PostgreSQL, auth, relatórios). O `app` funciona inteiro offline
no aparelho — import, painel, listas e estatísticas.

Falta: ligar o app à API para sync entre aparelhos, notificação de lembrete, e criar
o app na Meta para testar o modo conectado com credenciais reais. Ver `docs/ROADMAP.md`.

## Estrutura

```
packages/core/   lógica pura (parser do export, diff, estatísticas, métricas). Sem I/O.
packages/api/    Fastify + PostgreSQL: upload, persistência, relatórios, OAuth oficial.
packages/app/    Expo (React Native): telas iOS e Android, tudo local.
docs/            produto, arquitetura, formato do export, modo conectado, roadmap.
```

## Começando

```bash
npm install
npm run test          # 60 testes do core
npm run dev:api       # API em localhost:3000
npm run dev:app       # Expo
```

Para a API: copie `packages/api/.env.example` para `.env` e ajuste.
O schema do banco está em `packages/api/src/db/schema.sql`.

## Os dois modos

| | Import do arquivo | Modo conectado (API oficial) |
|---|---|---|
| **Quem** saiu / entrou | sim | **não** — a API não expõe a lista |
| Quantos saíram / entraram | sim | sim, e atualiza sozinho |
| Não te seguem de volta | sim | não |
| Histórico anterior ao app | sim | não, começa do zero |
| Demografia, alcance | não | sim |
| Conta pessoal | funciona | exige conta profissional |
| Espera | até 48h pelo export | nenhuma |

Os dois se complementam: o import tem os nomes, a API tem a frequência. Nenhum
substitui o outro, e a razão está em `docs/MODO-CONECTADO.md`.

## Ao pedir o export, dois passos importam mais que os outros

1. **"Todo o período"** — um export limitado a 12 meses não traz sua base completa de
   seguidores, só quem entrou na janela. O app detecta e avisa, mas a comparação fica
   prejudicada.
2. **Só "Seguidores e seguindo"** — o export completo passa de 100 MB porque vem com
   fotos, áudios e conversas. Filtrado, sai em kilobytes e em minutos.

O formato pode ser JSON ou HTML: o app lê os dois.

## Leia antes de programar

- **`CLAUDE.md`** — instruções para o Claude Code, incluindo as regras invioláveis
  do produto. Leia mesmo se você for humano.
- **`docs/EXPORT-INSTAGRAM.md`** — formato real dos arquivos e as armadilhas
  (paginação de `followers_N`, período limitado, o fuso que o HTML declara errado).
- **`docs/MODO-CONECTADO.md`** — o que a API oficial dá e o que não dá, e por que
  não "resolvemos" a diferença.
- **`docs/PRODUTO.md`** — features, diferenciais e a lista de não-objetivos.
- **`docs/ARQUITETURA.md`** — decisões e seus porquês.

## As três coisas que este projeto nunca vai fazer

1. Pedir a senha do Instagram do usuário.
2. Usar API privada, scraping autenticado ou automação de conta.
3. Prometer "quem viu seu perfil" — esse dado não existe em nenhuma fonte legítima.

Se uma ideia futura esbarrar em qualquer uma delas, a resposta é não.
O detalhamento está em `CLAUDE.md`, seção 3.
