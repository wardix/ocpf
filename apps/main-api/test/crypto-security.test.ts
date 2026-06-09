import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import path from 'path';

describe('Crypto Security - JWT_SECRET Enforcements', () => {
  it('should crash on import if JWT_SECRET is missing', () => {
    const result = spawnSync('bun', ['-e', "import './src/utils/crypto'"], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, JWT_SECRET: '' }
    });
    
    expect(result.status).not.toBe(0);
    const stderr = result.stderr.toString();
    expect(stderr).toContain('FATAL ERROR: JWT_SECRET environment variable is missing');
  });

  it('should succeed on import if JWT_SECRET is present', () => {
    const result = spawnSync('bun', ['-e', "import './src/utils/crypto'"], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, JWT_SECRET: 'test-secret-value-123' }
    });
    
    expect(result.status).toBe(0);
  });
});
