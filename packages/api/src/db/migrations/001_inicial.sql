-- Rastro — schema inicial
--
-- Princípio de retenção: guardamos snapshots, não arquivos. O zip enviado pelo
-- usuário é processado e descartado. O que fica é a lista de @s e datas, que já
-- é sensível o suficiente.
--
-- Nada aqui armazena senha do Instagram. Não existe coluna para isso e não deve
-- passar a existir. O modo conectado (ver connected_accounts, no fim do arquivo)
-- guarda um token OAuth que o próprio Instagram emite e o usuário revoga quando
-- quiser — isso é outra coisa, e mesmo assim fica criptografado.

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,          -- senha DO RASTRO (scrypt), nunca do Instagram
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- Um usuário pode acompanhar mais de um perfil (conta pessoal + conta do negócio).
CREATE TABLE profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  handle      TEXT NOT NULL,            -- o @ do próprio usuário, apenas rótulo
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, handle)
);

CREATE TABLE snapshots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  imported_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  exported_at  TIMESTAMPTZ,
  -- 'json' | 'html' | 'mixed'. O HTML tem precisão de minuto e fuso derivado do
  -- cabeçalho; guardar isso permite explicar na UI de onde vem a imprecisão.
  format       TEXT,
  -- Período que o export declara cobrir. Preenchido só quando o usuário limitou o
  -- período no pedido — e nesse caso a lista NÃO é a base completa. Comparar
  -- snapshots com janelas diferentes gera unfollows falsos: ver diff.reliability.
  data_window_from TIMESTAMPTZ,
  data_window_to   TIMESTAMPTZ,
  follower_count  INTEGER NOT NULL,
  following_count INTEGER NOT NULL,
  warnings     JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX snapshots_profile_time_idx ON snapshots (profile_id, imported_at DESC);

-- Uma linha por conta por snapshot. Cresce rápido: 5k seguidores x 24 imports/ano
-- = 120k linhas por perfil por ano. Aceitável, mas ver ROADMAP para a estratégia
-- de compactação de snapshots antigos.
CREATE TABLE snapshot_entries (
  snapshot_id  UUID NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,           -- followers | following | pendingRequestsSent | ...
  username     TEXT NOT NULL,
  since        TIMESTAMPTZ NOT NULL,    -- quando a relação começou (exato, do export)
  -- Nome de exibição, quando o export traz (só o HTML traz, e só em algumas listas).
  -- Nunca é identidade: dois perfis podem ter o mesmo nome.
  display_name TEXT,
  PRIMARY KEY (snapshot_id, kind, username)
);

CREATE INDEX snapshot_entries_lookup_idx ON snapshot_entries (snapshot_id, kind);

-- Eventos materializados a partir do diff. Guardar em vez de recalcular sempre
-- permite a linha do tempo e as notificações sem varrer todos os snapshots.
CREATE TABLE follow_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  username      TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('followed', 'unfollowed')),
  -- 'exact' quando veio de timestamp do export; 'window' quando foi inferido.
  -- A UI usa isso para não afirmar precisão que não temos.
  precision     TEXT NOT NULL CHECK (precision IN ('exact', 'window')),
  occurred_at   TIMESTAMPTZ NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  window_end    TIMESTAMPTZ NOT NULL,
  suspected_rename_of TEXT
);

CREATE INDEX follow_events_timeline_idx ON follow_events (profile_id, occurred_at DESC);

-- Renomeações confirmadas pelo usuário, para o parser parar de perguntar.
CREATE TABLE known_renames (
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  old_handle  TEXT NOT NULL,
  new_handle  TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, old_handle, new_handle)
);

-- ---------------------------------------------------------------------------
-- Modo conectado (API oficial do Instagram)
-- ---------------------------------------------------------------------------
-- Opcional e desligado por padrão. Guarda o token OAuth que o Instagram emite
-- depois de o usuário autorizar no site do próprio Instagram — não há senha
-- nossa envolvida, e o usuário revoga o acesso quando quiser nas configurações
-- da conta dele.
--
-- O token é gravado criptografado (AES-256-GCM, chave em TOKEN_ENCRYPTION_KEY).
-- Um vazamento do banco não pode virar acesso à conta de ninguém.
--
-- Limite honesto, e o motivo de este modo não substituir o import: a API oficial
-- não expõe a lista de seguidores. Daqui só sai número, nunca nome.

CREATE TABLE connected_accounts (
  profile_id       UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  ig_user_id       TEXT NOT NULL,
  username         TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,       -- AES-256-GCM, nunca em texto puro
  token_expires_at TIMESTAMPTZ NOT NULL,
  scopes           TEXT NOT NULL,
  connected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sync_at     TIMESTAMPTZ,
  -- Última falha de sync, para a UI poder dizer "reconecte" em vez de silenciar.
  last_error       TEXT
);

-- Amostras periódicas do perfil. A API só devolve o número de agora, então o
-- histórico é construído por amostragem: uma leitura por dia vira a série.
CREATE TABLE profile_metrics (
  profile_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sampled_at     TIMESTAMPTZ NOT NULL,
  follower_count INTEGER NOT NULL,
  follows_count  INTEGER,
  media_count    INTEGER,
  PRIMARY KEY (profile_id, sampled_at)
);

CREATE INDEX profile_metrics_series_idx ON profile_metrics (profile_id, sampled_at DESC);

-- Entradas e saídas agregadas por dia, da métrica oficial follows_and_unfollows.
-- Diz QUANTOS saíram. Nunca diz quem — esse dado não existe nesta fonte.
CREATE TABLE follow_activity (
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  follows     INTEGER NOT NULL,
  unfollows   INTEGER NOT NULL,
  PRIMARY KEY (profile_id, day)
);
