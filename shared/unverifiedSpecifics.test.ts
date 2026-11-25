import { describe, expect, it } from 'vitest';
import { unverifiedSpecifics } from './unverifiedSpecifics.ts';

describe('unverifiedSpecifics', () => {
  it('finds commands, flags, config keys and named settings', () => {
    expect(
      unverifiedSpecifics('Set `meshConfig.defaultConfig` and pass --turbo-mode, or set proxyMetadata.bufferSize=64 and enable the "warp" feature.'),
    ).toEqual(['`meshConfig.defaultConfig`', '--turbo-mode', 'proxyMetadata.bufferSize', 'proxyMetadata.bufferSize=64', '"warp" feature']);
  });

  it('finds nothing in a plain-language answer', () => {
    expect(
      unverifiedSpecifics("I'm not familiar with that mode. Could you tell me what it does? In general I'd measure the latency first and cut whatever the proxy adds."),
    ).toEqual([]);
  });
});
