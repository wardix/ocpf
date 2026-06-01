import type { Context, Next } from 'hono';
import { redis } from '../config/redis';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator: (c: Context) => string;
}

export const rateLimiter = (options: RateLimitOptions) => {
  return async (c: Context, next: Next) => {
    const key = options.keyGenerator(c);
    const limitKey = `rate_limit:${key}`;
    
    try {
      const current = await redis.incr(limitKey);
      
      // Jika ini adalah request pertama di window ini, set waktu kedaluwarsa (TTL)
      if (current === 1) {
        await redis.pexpire(limitKey, options.windowMs);
      }
      
      if (current > options.max) {
        const ttl = await redis.pttl(limitKey);
        c.header('Retry-After', Math.ceil(ttl / 1000).toString());
        return c.json({ 
          error: 'Too Many Requests', 
          message: 'Tingkat permintaan Anda dibatasi. Silakan coba lagi nanti.' 
        }, 429);
      }
    } catch (e) {
      console.error('Rate limiter Redis error:', e);
      // Jika Redis down, kita biarkan request lewat agar aplikasi tetap berjalan (Fail-open)
    }
    
    await next();
  };
};
