# Deploy — VPS Hostinger + Dokploy

## Forma do sistema

```
   app (Expo, celular)
        │  HTTPS
        ▼
   Traefik  ← Dokploy administra, emite o certificado
        │
        ▼
   rastro-api  (container Node, sem porta pública)
        │
        ▼
   PostgreSQL  (container ou serviço do Dokploy, sem porta pública)
```

Três decisões e o motivo de cada uma:

**Um serviço só, não microserviços.** O produto tem um domínio (snapshots de uma
conta) e uma equipe de uma pessoa. Separar API, worker e scheduler em serviços
diferentes agora custa três deploys, três logs e um problema de rede a cada bug,
para resolver uma escala que não existe. O `scheduler.ts` roda dentro do processo
da API. Quando um dia isso incomodar, o corte natural é tirar o worker de import
para fora — e a fila em `import_jobs` já está desenhada para permitir isso sem
mudar o schema.

**Postgres, sem Redis.** Fila, cache e lock cabem no Postgres nesta escala
(`SELECT ... FOR UPDATE SKIP LOCKED` resolve fila; `pg_advisory_lock` resolve
lock). Redis é mais um serviço para manter de pé, mais um backup para configurar
e mais um jeito de perder dados por engano.

**Nada de porta pública além do Traefik.** Isso vale especialmente para o banco.

## Antes do primeiro deploy

Acessar a API por IP e HTTP não serve. Por ali passam o JWT do usuário e, no
import, a lista inteira de contatos dele — em texto claro, legível por qualquer
intermediário da rota.

O ambiente já está montado assim:

| | |
|---|---|
| Aplicação | `rastro-1beam0` |
| Domínio | `rastro.urlsnapshot.com` → porta 4891 |
| Banco | serviço PostgreSQL no mesmo projeto |

Confira, antes do primeiro deploy:

1. **TLS ligado** no domínio (aba Domains → certificado Let's Encrypt). Sem isso
   o Traefik serve HTTP puro e o item acima vale inteiro.
2. **A porta 4891 não publicada** no firewall da VPS. O `docker-compose.yml` usa
   `expose`, não `ports`, justamente para isso.
3. **`CORS_ORIGINS=https://rastro.urlsnapshot.com`** nas variáveis. Sem declarar,
   só o desenvolvimento local é aceito e a versão web falha em produção.

## O banco: use o host interno

O Dokploy mostra duas formas de chegar ao banco. Elas não são equivalentes:

```
external host  →  147.79.87.169:54320   pela internet, exposto ao mundo
internal host  →  <nome-do-servico>:5432  pela rede do Docker, invisível de fora
```

**A API deve usar o interno.** Os dois containers estão na mesma máquina; mandar
o tráfego dar a volta pela internet só adiciona latência e superfície de ataque.
O `DATABASE_URL` da aplicação aponta para o nome do serviço, não para o IP.

O host externo existe para você administrar (DBeaver, `psql`, backup). Se não for
usar, **feche essa porta**: um Postgres exposto na internet recebe tentativa de
login em minutos. Se for manter aberto, use uma senha longa e aleatória — e
lembre que ela circula em texto claro se a conexão não for SSL.

Senha com caractere especial precisa de escape na URL: `@` vira `%40`. O driver
da API aguenta a forma crua, mas `psql` e as ferramentas gráficas não.

## Variáveis obrigatórias

Gere os segredos na própria VPS e cole na aba **Environment** do Dokploy:

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 32   # TOKEN_ENCRYPTION_KEY  (precisa ter 32 bytes)
openssl rand -base64 24   # POSTGRES_PASSWORD
```

`TOKEN_ENCRYPTION_KEY` é a chave que cifra os tokens do modo conectado. Perdê-la
significa que ninguém mais consegue ler os tokens salvos e todos os usuários
precisam reconectar. Guarde fora da VPS.

## Banco

Duas opções, e a primeira é melhor:

**Serviço do Dokploy** (Databases → PostgreSQL): traz backup agendado e restore
pela interface. Apague o serviço `db` do `docker-compose.yml` e aponte
`DATABASE_URL` para o host interno que a UI mostra.

**Container do compose**: funciona, mas o backup é problema seu. No mínimo, um
cron diário:

```bash
docker exec rastro-db pg_dump -U rastro rastro | gzip > /backup/rastro-$(date +%F).sql.gz
```

Backup que nunca foi restaurado não é backup. Teste a restauração uma vez.

## Migrations

Aplicadas sozinhas no `start`, antes de o servidor escutar. O runner
(`packages/api/src/db/migrate.ts`) toma um advisory lock, então dois containers
subindo ao mesmo tempo não colidem.

Regra que o runner impõe: **migration aplicada não se edita**. Ele guarda o
checksum de cada arquivo e recusa subir se o conteúdo mudou. Para alterar uma
tabela, crie `003_...sql`.

## Sequência do primeiro deploy

1. `git push` do repositório.
2. Dokploy → Create Application → Docker Compose, apontando para o repo.
3. Preencher as variáveis de ambiente.
4. Cadastrar o domínio e ligar TLS.
5. Deploy.
6. `curl https://api.seudominio.com.br/health` → `{"status":"ok"}`.
7. Nos logs, conferir `aplicando 001_inicial.sql` e `banco atualizado`.

## O app aponta para onde

`packages/app/src/api/client.ts` usa `EXPO_PUBLIC_API_URL`, com
`https://rastro.urlsnapshot.com` como padrão — que é o valor que precisa valer no
app publicado. Para desenvolver contra a máquina local, copie
`packages/app/.env.example` para `.env`.

Cuidado com uma coisa: variável `EXPO_PUBLIC_*` **vai dentro do bundle** e pode
ser lida por quem baixar o app. Serve para endereço, nunca para segredo.

## O que monitorar desde o começo

| Sinal | Por quê |
|---|---|
| `import_jobs` com `status='falhou'` | é o Instagram tendo mudado o formato do export |
| `ENTRIES_SKIPPED` nos `warnings` de snapshot | idem, versão silenciosa: parseou, mas perdeu registros |
| `connected_accounts.last_error` | token expirado — o usuário precisa reconectar |
| Tamanho de `snapshot_entries` | a tabela que cresce; ver a poda em `snapshots.entries_pruned_at` |

O primeiro item é o mais importante do projeto inteiro: quando o Instagram mudar
o export, o app não quebra com estardalhaço — ele passa a mostrar números errados
em silêncio. Ver `docs/EXPORT-INSTAGRAM.md`.
