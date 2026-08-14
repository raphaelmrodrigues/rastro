-- Rastro — o que o produto precisa para ser vendido, e não só usado.
--
-- A 001 modela o domínio (snapshots, eventos, métricas). Esta modela a operação:
-- sessão revogável, verificação de e-mail, assinatura, push, fila de import e
-- trilha de auditoria.
--
-- Duas regras que valem para o arquivo inteiro:
--
--   1. Nenhum segredo em texto puro. Refresh token, token de e-mail e recibo de
--      loja entram como SHA-256. O banco guarda o suficiente para *verificar*,
--      nunca para *reproduzir*. Um dump não pode virar sessão de ninguém.
--   2. Nada aqui encosta em credencial do Instagram. Continua não existindo
--      coluna para senha, cookie ou sessão de terceiro, e continua não devendo
--      passar a existir — regras 1 e 2 do CLAUDE.md.

-- ---------------------------------------------------------------------------
-- Conta
-- ---------------------------------------------------------------------------

-- E-mail não verificado é conta que não recebe notificação e não recupera senha.
-- Sem esta coluna não dá para bloquear cadastro com e-mail de outra pessoa.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Marca de quando a senha mudou. Toda sessão emitida antes disso morre — é o que
-- torna "trocar a senha" uma ação com efeito real em quem já estava logado.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();

/*
 * Sessões.
 *
 * O JWT atual dura 7 dias e não pode ser revogado: uma vez emitido, vale até
 * expirar, mesmo que o usuário troque a senha ou perca o celular. Para um app
 * pago isso não se sustenta. O desenho daqui em diante:
 *
 *   access token  = JWT curto (15 min), sem consulta ao banco, como hoje
 *   refresh token = linha desta tabela, longo (60 dias), revogável a qualquer momento
 *
 * Guardamos só o hash: quem lê o banco não consegue se passar por ninguém.
 */
CREATE TABLE sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,     -- sha256 do token, nunca o token
  -- Rótulos para a tela "seus dispositivos". Nada aqui identifica a pessoa além
  -- do que ela mesma vê ao abrir essa tela.
  device_label       TEXT,
  platform           TEXT CHECK (platform IN ('ios', 'android', 'web')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  revoked_at         TIMESTAMPTZ,
  revoked_reason     TEXT                       -- 'logout' | 'senha_alterada' | 'admin' | 'rotacao'
);

CREATE INDEX sessions_user_idx ON sessions (user_id, revoked_at, expires_at);

/*
 * Tokens de uso único: confirmar e-mail e redefinir senha.
 *
 * `purpose` no lugar de duas tabelas iguais. `used_at` em vez de DELETE, porque
 * um token reapresentado precisa ser distinguido de um token que nunca existiu —
 * o primeiro é sinal de ataque e vai para account_events.
 */
CREATE TABLE user_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('email_verify', 'password_reset')),
  token_hash  TEXT NOT NULL UNIQUE,            -- sha256, idem sessions
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Só um token vivo por finalidade: pedir "esqueci a senha" três vezes não deixa
-- três chaves válidas circulando por e-mail.
CREATE UNIQUE INDEX user_tokens_um_ativo_idx
  ON user_tokens (user_id, purpose)
  WHERE used_at IS NULL;

-- ---------------------------------------------------------------------------
-- Assinatura
-- ---------------------------------------------------------------------------

/*
 * A fonte da verdade é sempre a loja (Apple/Google), nunca esta tabela. O que
 * fica aqui é a última resposta conhecida delas, para o app não precisar
 * consultar a loja a cada request.
 *
 * Consequência de desenho: nada de `users.is_premium`. Assinatura tem período,
 * carência e reembolso; um booleano perde os três e vira suporte manual.
 */
CREATE TABLE subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL CHECK (provider IN ('apple', 'google', 'stripe', 'cortesia')),
  -- Id da assinatura no provedor. Para a Apple é o original_transaction_id, que é
  -- o único identificador estável ao longo das renovações.
  provider_subscription_id TEXT NOT NULL,
  product_id               TEXT NOT NULL,       -- 'rastro.premium.mensal', etc.
  status                   TEXT NOT NULL CHECK (status IN (
                             'trial', 'ativa', 'carencia', 'pausada',
                             'cancelada', 'expirada', 'reembolsada'
                           )),
  -- Enquanto agora() < current_period_end o acesso vale, mesmo com status
  -- 'cancelada': cancelar não é perder o que já foi pago.
  current_period_end       TIMESTAMPTZ,
  started_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  canceled_at              TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subscription_id)
);

CREATE INDEX subscriptions_user_idx ON subscriptions (user_id, status);

/*
 * Webhooks das lojas.
 *
 * Apple e Google reenviam a mesma notificação quando não recebem 200 — às vezes
 * dias depois. Sem a chave única abaixo, um reenvio de "assinatura cancelada"
 * que chega fora de ordem sobrescreve uma renovação já processada.
 *
 * Grava-se primeiro, processa-se depois: se o processamento falhar, o evento não
 * se perde e o reprocessamento é seguro.
 */
CREATE TABLE billing_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  type              TEXT NOT NULL,
  payload           JSONB NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  error             TEXT,
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX billing_events_pendentes_idx
  ON billing_events (received_at)
  WHERE processed_at IS NULL;

/*
 * O acesso efetivo de um usuário, em um lugar só.
 *
 * Existe como view para que "esta pessoa é premium?" tenha exatamente uma
 * definição no sistema. Espalhar essa regra por rota é como nascem os bugs em
 * que o usuário paga e continua vendo a tela de upgrade.
 */
CREATE VIEW user_access AS
SELECT
  u.id AS user_id,
  EXISTS (
    SELECT 1 FROM subscriptions s
    WHERE s.user_id = u.id
      AND s.status IN ('trial', 'ativa', 'carencia', 'cancelada')
      AND (s.current_period_end IS NULL OR s.current_period_end > now())
  ) AS premium
FROM users u
WHERE u.deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Notificação
-- ---------------------------------------------------------------------------

/*
 * Um usuário, vários aparelhos. O token do Expo é por instalação e muda sozinho
 * (reinstalação, restauração de backup), então ele é a chave, não o aparelho.
 *
 * `timezone` não é enfeite: "alguém deixou de te seguir" às 4h da manhã é
 * desinstalação garantida. O agendador respeita o fuso de quem recebe.
 */
CREATE TABLE devices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL UNIQUE,
  platform        TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app_version     TEXT,
  timezone        TEXT,                         -- IANA, ex: 'America/Sao_Paulo'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- O Expo devolve DeviceNotRegistered quando o app foi desinstalado. Continuar
  -- disparando para esse token é o que faz um projeto ser marcado como abusivo.
  disabled_at     TIMESTAMPTZ,
  disabled_reason TEXT
);

CREATE INDEX devices_user_idx ON devices (user_id) WHERE disabled_at IS NULL;

/*
 * Histórico do que foi enviado.
 *
 * `dedupe_key` é o que impede o mesmo aviso de sair duas vezes quando o
 * agendador roda de novo após uma falha parcial. Exemplo de chave:
 * 'queda:<profile_id>:2026-08-13'.
 */
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id  UUID REFERENCES profiles(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                    -- 'queda_seguidores' | 'lembrete_import' | 'sync_falhou'
  dedupe_key  TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);

CREATE INDEX notifications_user_time_idx ON notifications (user_id, sent_at DESC);

/*
 * Preferências, por perfil. Sem isto o único jeito de parar de receber aviso é
 * desinstalar — e é assim que se perde um assinante em vez de uma notificação.
 */
CREATE TABLE notification_prefs (
  profile_id           UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  queda_seguidores     BOOLEAN NOT NULL DEFAULT true,
  lembrete_import      BOOLEAN NOT NULL DEFAULT true,
  lembrete_dias        INTEGER NOT NULL DEFAULT 15 CHECK (lembrete_dias BETWEEN 1 AND 90),
  -- Não notificar variação irrelevante: perder 1 seguidor num perfil de 5 mil é ruído.
  queda_minima         INTEGER NOT NULL DEFAULT 1 CHECK (queda_minima >= 1),
  -- Faixa de silêncio, em hora local do aparelho (0-23).
  silencio_inicio_hora INTEGER NOT NULL DEFAULT 22 CHECK (silencio_inicio_hora BETWEEN 0 AND 23),
  silencio_fim_hora    INTEGER NOT NULL DEFAULT 8  CHECK (silencio_fim_hora BETWEEN 0 AND 23)
);

-- ---------------------------------------------------------------------------
-- Import assíncrono
-- ---------------------------------------------------------------------------

/*
 * O export completo passa de 400 MB. Processar isso dentro do request significa
 * um HTTP aberto por minutos, morrendo em qualquer timeout de proxy no caminho.
 * O upload vira job; o app pergunta o andamento.
 *
 * `file_sha256` dá idempotência: reenviar o mesmo arquivo (rede caiu, usuário
 * tocou duas vezes) devolve o job existente em vez de criar um snapshot gêmeo.
 */
CREATE TABLE import_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pendente'
               CHECK (status IN ('pendente', 'processando', 'concluido', 'falhou')),
  file_sha256  TEXT NOT NULL,
  file_bytes   BIGINT NOT NULL,
  snapshot_id  UUID REFERENCES snapshots(id) ON DELETE SET NULL,
  -- Mensagem para o usuário, não stack trace. Nada de conteúdo do arquivo aqui:
  -- log de erro é o lugar mais fácil de vazar @ sem perceber (regra 5).
  error        TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  UNIQUE (profile_id, file_sha256)
);

CREATE INDEX import_jobs_fila_idx
  ON import_jobs (created_at)
  WHERE status = 'pendente';

-- ---------------------------------------------------------------------------
-- Retenção
-- ---------------------------------------------------------------------------

/*
 * snapshot_entries é a tabela que cresce: ~5 mil linhas por import, 24 imports
 * por ano, por perfil. Com mil usuários isso é ordem de 10^8 linhas em dois anos.
 *
 * A saída não é apagar histórico — é notar que os snapshots antigos só importam
 * como *evento* ("fulano saiu em março"), e isso já está materializado em
 * follow_events. Passado um prazo, as entries do snapshot são descartadas e a
 * data fica registrada aqui, para a UI dizer "detalhe completo até tal mês" em
 * vez de mostrar uma lista silenciosamente vazia.
 */
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS entries_pruned_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------------

/*
 * Trilha do que aconteceu com a conta: login, troca de senha, exportação de
 * dados, exclusão. Duas razões, uma legal e uma prática:
 *
 *   - LGPD/GDPR: o titular pode perguntar o que foi feito com os dados dele;
 *   - suporte: sem isto, "sumiram meus dados" é irrespondível.
 *
 * IP é dado pessoal e por isso tem prazo: o job de limpeza zera `ip` depois de
 * 90 dias e mantém o resto da linha, que é o que serve para auditoria.
 */
CREATE TABLE account_events (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- SET NULL, e não CASCADE: excluir a conta apaga os dados da pessoa, mas a
  -- linha "conta X foi excluída em tal data" precisa sobreviver justamente para
  -- provar que a exclusão aconteceu. Sem user_id ela não identifica mais ninguém.
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  type       TEXT NOT NULL,
  ip         INET,
  user_agent TEXT,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX account_events_user_idx ON account_events (user_id, created_at DESC);
CREATE INDEX account_events_type_idx ON account_events (type, created_at DESC);
