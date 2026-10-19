import { it, expect } from 'vitest';
import { BRIDGE_JS } from '../src/server/preview/bridge.js';
it('bridge parses standalone', () => { expect(() => new Function(BRIDGE_JS)).not.toThrow(); expect(BRIDGE_JS).not.toMatch(/__name\(/); });
