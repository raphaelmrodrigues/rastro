-- Telemetria de falha: parsing quebrado e erro fatal no app.
--
-- Por que isto existe: o Instagram muda o formato do export sem aviso e sem
-- versionamento. Quando isso acontecer, o parser vai começar a descartar listas
-- inteiras — e o sintoma para o usuário é uma tela dizendo "você segue 0
-- pessoas" com toda a cara de dado correto. Sem esta tabela, o dono do projeto
-- só descobre por avaliação ruim na loja, semanas depois.
--
-- O QUE NUNCA PODE ENTRAR AQUI: conteúdo de snapshot. Nem @, nem nome, nem
-- texto de mensagem. A regra 5 do CLAUDE.md vale inteira, e o risco é concreto:
-- o campo `detail` de um ParseWarning traz frases como
-- 'Entrada "fulano" sem timestamp'. Por isso o app envia código + arquivo +
-- contagem, e nunca o texto do aviso. Ver lib/telemetria.ts no app.

CREATE TABLE IF NOT EXISTS app_reports (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- 'parse'  -> o import terminou, mas com avisos que valem investigar
  -- 'crash'  -> erro não tratado que derrubou uma tela
  kind        TEXT NOT NULL CHECK (kind IN ('parse', 'crash')),

  app_version TEXT,
  platform    TEXT CHECK (platform IN ('ios', 'android', 'web')),

  -- SET NULL e opcional: um crash pode acontecer antes do login, e a exclusão de
  -- conta não deve apagar o sinal de que o parser está quebrado para todo mundo.
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Estrutura fechada, montada no app:
  --   parse: { warnings: [{code, file, count}], format, followers, following, files }
  --   crash: { name, message, stack, screen }
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- O painel pergunta sempre "o que quebrou nos últimos N dias", nessa ordem.
CREATE INDEX IF NOT EXISTS app_reports_kind_time_idx ON app_reports (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS app_reports_version_idx ON app_reports (app_version, created_at DESC);
