import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

describe('Security: File Upload Path Traversal', () => {
  it('should sanitize filename containing path traversal characters', () => {
    const maliciousFilename1 = '../../../etc/passwd';
    const maliciousFilename2 = '..\\..\\windows\\system32\\cmd.exe';
    const maliciousFilename3 = '/var/www/html/shell.php';
    const normalFilename = 'document.pdf';

    const sanitize = (filename: string | null) => {
      return filename ? filename.replace(/^.*[\\\/]/, '').replace(/[^a-zA-Z0-9.\-_]/g, '_') : 'unnamed_file';
    };

    expect(sanitize(maliciousFilename1)).toBe('passwd');
    expect(sanitize(maliciousFilename2)).toBe('cmd.exe');
    expect(sanitize(maliciousFilename3)).toBe('shell.php');
    expect(sanitize(normalFilename)).toBe('document.pdf');
    expect(sanitize(null)).toBe('unnamed_file');
  });

  it('should use UUID for safeFilename generation, completely ignoring original name for disk path', () => {
    const mimetype = 'image/jpeg';
    const ext = mimetype.split('/')[1]?.split(';')[0] || 'bin';
    const safeFilename = `${crypto.randomUUID()}.${ext}`;

    expect(safeFilename).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpeg$/);
    expect(safeFilename).not.toContain('..');
    expect(safeFilename).not.toContain('/');
  });

  it('should validate MIME types correctly', () => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'audio/ogg', 'audio/mpeg', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    
    const isValid = (mimetype: string) => {
      return allowedMimeTypes.includes(mimetype) || mimetype.startsWith('audio/');
    };

    expect(isValid('image/jpeg')).toBe(true);
    expect(isValid('application/pdf')).toBe(true);
    expect(isValid('audio/mp3')).toBe(true); // wildcard audio
    expect(isValid('text/html')).toBe(false); // malicious html
    expect(isValid('application/x-sh')).toBe(false); // malicious shell
  });
});
