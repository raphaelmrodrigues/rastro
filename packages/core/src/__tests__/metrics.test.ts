import { describe, expect, it } from 'vitest';
import {
  buildDailySeries,
  parseAudienceBreakdown,
  parseFollowActivity,
  parseProfileSample,
  summarizeSeries,
  MODE_CAPABILITIES,
} from '../metrics.js';

const day = (d: number, hour = 12) => Date.UTC(2026, 2, d, hour);

describe('buildDailySeries', () => {
  it('mantém uma amostra por dia, a última', () => {
    const series = buildDailySeries([
      { at: day(1, 8), followerCount: 100 },
      { at: day(1, 20), followerCount: 105 },
      { at: day(2, 8), followerCount: 110 },
    ]);

    expect(series).toHaveLength(2);
    expect(series[0].followerCount).toBe(105);
    expect(series[1].netChange).toBe(5);
  });

  it('deixa o primeiro ponto sem variação em vez de fingir que foi zero', () => {
    const series = buildDailySeries([{ at: day(1), followerCount: 100 }]);
    expect(series[0].netChange).toBeNull();
  });

  it('marca buraco de coleta para o gráfico não achatar uma semana num dia', () => {
    const series = buildDailySeries([
      { at: day(1), followerCount: 100 },
      { at: day(8), followerCount: 130 },
    ]);

    expect(series[1].gapDays).toBe(7);
    expect(series[1].netChange).toBe(30);
  });

  it('ordena por dia mesmo com amostras fora de ordem', () => {
    const series = buildDailySeries([
      { at: day(3), followerCount: 120 },
      { at: day(1), followerCount: 100 },
    ]);

    expect(series.map((p) => p.followerCount)).toEqual([100, 120]);
  });
});

describe('summarizeSeries', () => {
  it('usa a diferença entre pontas, não a soma das variações', () => {
    // Somar netChange propagaria o buraco de coleta; a diferença entre pontas não.
    const resumo = summarizeSeries(
      buildDailySeries([
        { at: day(1), followerCount: 100 },
        { at: day(10), followerCount: 90 },
      ]),
    );

    expect(resumo).toEqual({ from: '2026-03-01', to: '2026-03-10', net: -10, startCount: 100, endCount: 90 });
  });

  it('devolve null quando não há dois pontos para comparar', () => {
    expect(summarizeSeries(buildDailySeries([{ at: day(1), followerCount: 100 }]))).toBeNull();
  });
});

describe('parseFollowActivity', () => {
  it('separa entradas de saídas pelo radical "unfollow"', () => {
    // Os rótulos do breakdown já mudaram de nome entre versões da API; a
    // classificação por radical sobrevive a isso.
    const raw = {
      data: [
        {
          name: 'follows_and_unfollows',
          total_value: {
            breakdowns: [
              {
                dimension_keys: ['follow_type'],
                results: [
                  { dimension_values: ['FOLLOWER'], value: 12 },
                  { dimension_values: ['UNFOLLOWER'], value: 5 },
                ],
              },
            ],
          },
        },
      ],
    };

    expect(parseFollowActivity(raw, '2026-03-01')).toEqual({
      day: '2026-03-01',
      follows: 12,
      unfollows: 5,
    });
  });

  it('devolve zeros em vez de quebrar quando a resposta vem vazia', () => {
    expect(parseFollowActivity({}, '2026-03-01')).toEqual({
      day: '2026-03-01',
      follows: 0,
      unfollows: 0,
    });
    expect(parseFollowActivity(null, '2026-03-01').follows).toBe(0);
  });
});

describe('parseAudienceBreakdown', () => {
  it('ordena do maior para o menor', () => {
    const raw = {
      data: [
        {
          name: 'follower_demographics',
          total_value: {
            breakdowns: [
              {
                dimension_keys: ['country'],
                results: [
                  { dimension_values: ['PT'], value: 10 },
                  { dimension_values: ['BR'], value: 180 },
                ],
              },
            ],
          },
        },
      ],
    };

    expect(parseAudienceBreakdown(raw, 'country').entries).toEqual([
      { label: 'BR', value: 180 },
      { label: 'PT', value: 10 },
    ]);
  });
});

describe('parseProfileSample', () => {
  it('lê a contagem do perfil', () => {
    const sample = parseProfileSample(
      { username: 'fulano', followers_count: 222, follows_count: 1158, media_count: 40 },
      day(1),
    );

    expect(sample).toEqual({ at: day(1), followerCount: 222, followsCount: 1158, mediaCount: 40 });
  });

  it('devolve null quando não veio contagem, para não gravar amostra falsa', () => {
    // Uma amostra com followerCount 0 gravada por engano vira um despencar no gráfico.
    expect(parseProfileSample({ username: 'fulano' }, day(1))).toBeNull();
  });
});

describe('MODE_CAPABILITIES', () => {
  it('afirma que o modo conectado não responde "quem" saiu', () => {
    // Este é o limite do produto. Se algum dia este teste for "consertado" para
    // dizer outra coisa, é porque alguém trocou a API oficial por API privada.
    const quem = MODE_CAPABILITIES.find((c) => c.question.startsWith('QUEM deixou'));

    expect(quem?.connectedMode).toBe('no');
    expect(quem?.fileMode).toBe('yes');
  });
});
