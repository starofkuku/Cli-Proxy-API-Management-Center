import { describe, expect, test } from 'bun:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse as parseYaml } from 'yaml';
import { useVisualConfig } from '../src/hooks/useVisualConfig';

describe('visual config management performance', () => {
  test('loads and writes gzip and recent usage cache settings', () => {
    function Harness() {
      const visualConfig = useVisualConfig();
      const [phase, setPhase] = useState(0);

      if (phase === 0) {
        visualConfig.loadVisualValuesFromYaml(
          'management-performance:\n  gzip-enabled: false\n  usage-recent-cache-enabled: true\n'
        );
        setPhase(1);
      } else if (phase === 1) {
        expect(visualConfig.visualValues.managementGzipEnabled).toBe(false);
        expect(visualConfig.visualValues.usageRecentCacheEnabled).toBe(true);
        visualConfig.setVisualValues({
          managementGzipEnabled: true,
          usageRecentCacheEnabled: false,
        });
        setPhase(2);
      } else {
        return createElement(
          'pre',
          null,
          visualConfig.applyVisualChangesToYaml(
            'management-performance:\n  gzip-enabled: false\n  usage-recent-cache-enabled: true\n'
          )
        );
      }

      return null;
    }

    const markup = renderToStaticMarkup(createElement(Harness));
    const merged = markup.slice('<pre>'.length, -'</pre>'.length);

    expect(parseYaml(merged)).toEqual({
      'management-performance': {
        'gzip-enabled': true,
        'usage-recent-cache-enabled': false,
      },
    });
  });
});
