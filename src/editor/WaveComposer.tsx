import type { ReactElement } from 'react';
import type { Draft } from './draft.js';
import type { WaveTotals } from './waves.js';

/**
 * The wave composer (#34).
 *
 * A table, because a wave *is* a table: groups down, fields across. The live
 * totals beside each row are the reason this beats editing JSON — an author
 * changing a count from 8 to 12 sees what it costs in health and pays in gold
 * without leaving the row, and the numbers come from the simulation's own
 * tables rather than from arithmetic repeated here.
 */

export interface WaveComposerProps {
  draft: Draft;
  totals: readonly WaveTotals[];
  floorSeconds: number;
  enemyIds: readonly string[];
  onChange: (next: Draft) => void;
}

type Group = Draft['waves'][number]['groups'][number];

const seconds = (value: number): string =>
  value >= 60 ? `${Math.floor(value / 60)}m ${Math.round(value % 60)}s` : `${Math.round(value)}s`;

export function WaveComposer({
  draft,
  totals,
  floorSeconds,
  enemyIds,
  onChange,
}: WaveComposerProps): ReactElement {
  const editWave = (index: number, change: Partial<Draft['waves'][number]>): void => {
    onChange({
      ...draft,
      waves: draft.waves.map((wave, i) => (i === index ? { ...wave, ...change } : wave)),
    });
  };

  const editGroup = (waveIndex: number, groupIndex: number, change: Partial<Group>): void => {
    const wave = draft.waves[waveIndex];
    if (wave === undefined) return;
    editWave(waveIndex, {
      groups: wave.groups.map((group, i) => (i === groupIndex ? { ...group, ...change } : group)),
    });
  };

  const addGroup = (waveIndex: number): void => {
    const wave = draft.waves[waveIndex];
    if (wave === undefined) return;
    editWave(waveIndex, {
      groups: [
        ...wave.groups,
        {
          enemy: enemyIds[0] ?? 'riftling',
          count: 5,
          intervalSeconds: 0.8,
          delaySeconds: 0,
          spawnPoint: 0,
        },
      ],
    });
  };

  /* A wave needs at least one group, which the schema says and this enforces
     rather than letting the author reach a draft that will not parse. */
  const removeGroup = (waveIndex: number, groupIndex: number): void => {
    const wave = draft.waves[waveIndex];
    if (wave === undefined || wave.groups.length <= 1) return;
    editWave(waveIndex, { groups: wave.groups.filter((_, i) => i !== groupIndex) });
  };

  const addWave = (): void => {
    const last = draft.waves[draft.waves.length - 1];
    onChange({
      ...draft,
      waves: [
        ...draft.waves,
        {
          autoStartDelaySeconds: last?.autoStartDelaySeconds ?? 20,
          clearBonus: 0,
          groups: [
            {
              enemy: enemyIds[0] ?? 'riftling',
              count: 5,
              intervalSeconds: 0.8,
              delaySeconds: 0,
              spawnPoint: 0,
            },
          ],
        },
      ],
    });
  };

  const removeWave = (index: number): void => {
    if (draft.waves.length <= 1) return;
    onChange({ ...draft, waves: draft.waves.filter((_, i) => i !== index) });
  };

  return (
    <section className="ed__waves" data-testid="wave-composer">
      <header className="ed__waveshead">
        <h2>Waves</h2>
        <span className="ed__floor">
          {draft.waves.length} {draft.waves.length === 1 ? 'wave' : 'waves'} · at least{' '}
          {seconds(floorSeconds)} before a shot is fired
        </span>
        <button type="button" onClick={addWave}>
          Add wave
        </button>
      </header>

      {draft.waves.map((wave, waveIndex) => {
        const total = totals[waveIndex];
        return (
          <article className="ed__wave" key={waveIndex} data-testid={`wave-${waveIndex}`}>
            <header>
              <strong>Wave {waveIndex + 1}</strong>
              <label>
                auto-start
                <input
                  type="number"
                  min={0}
                  aria-label={`Wave ${waveIndex + 1} auto-start delay`}
                  value={wave.autoStartDelaySeconds}
                  onChange={(event) =>
                    editWave(waveIndex, { autoStartDelaySeconds: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                clear bonus
                <input
                  type="number"
                  min={0}
                  aria-label={`Wave ${waveIndex + 1} clear bonus`}
                  value={wave.clearBonus}
                  onChange={(event) =>
                    editWave(waveIndex, { clearBonus: Number(event.target.value) })
                  }
                />
              </label>
              <span className="ed__totals" data-testid={`wave-totals-${waveIndex}`}>
                {total?.count ?? 0} enemies · {Math.round(total?.hp ?? 0)} hp · {total?.bounty ?? 0}{' '}
                gold · {seconds(total?.spawnSeconds ?? 0)} to spawn
              </span>
              <button type="button" onClick={() => removeWave(waveIndex)}>
                Remove wave
              </button>
            </header>

            {(total?.unknownEnemies.length ?? 0) > 0 && (
              <p className="ed__bad">Unknown enemy: {total?.unknownEnemies.join(', ')}</p>
            )}

            <table>
              <thead>
                <tr>
                  <th>Enemy</th>
                  <th>Count</th>
                  <th>Interval</th>
                  <th>Delay</th>
                  <th>Spawn</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {wave.groups.map((group, groupIndex) => (
                  <tr key={groupIndex}>
                    <td>
                      <select
                        aria-label={`Wave ${waveIndex + 1} group ${groupIndex + 1} enemy`}
                        value={group.enemy}
                        onChange={(event) =>
                          editGroup(waveIndex, groupIndex, { enemy: event.target.value })
                        }
                      >
                        {enemyIds.map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        aria-label={`Wave ${waveIndex + 1} group ${groupIndex + 1} count`}
                        value={group.count}
                        onChange={(event) =>
                          editGroup(waveIndex, groupIndex, { count: Number(event.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        aria-label={`Wave ${waveIndex + 1} group ${groupIndex + 1} interval`}
                        value={group.intervalSeconds}
                        onChange={(event) =>
                          editGroup(waveIndex, groupIndex, {
                            intervalSeconds: Number(event.target.value),
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        aria-label={`Wave ${waveIndex + 1} group ${groupIndex + 1} delay`}
                        value={group.delaySeconds}
                        onChange={(event) =>
                          editGroup(waveIndex, groupIndex, {
                            delaySeconds: Number(event.target.value),
                          })
                        }
                      />
                    </td>
                    <td>
                      <select
                        aria-label={`Wave ${waveIndex + 1} group ${groupIndex + 1} spawn point`}
                        value={group.spawnPoint}
                        onChange={(event) =>
                          editGroup(waveIndex, groupIndex, {
                            spawnPoint: Number(event.target.value),
                          })
                        }
                      >
                        {draft.spawnPoints.map((spawn) => (
                          <option key={spawn.id} value={spawn.id}>
                            {spawn.id}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button type="button" onClick={() => removeGroup(waveIndex, groupIndex)}>
                        &times;
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" onClick={() => addGroup(waveIndex)}>
              Add group
            </button>
          </article>
        );
      })}
    </section>
  );
}
