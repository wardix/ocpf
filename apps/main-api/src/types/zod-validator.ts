import { zValidator as realZValidator } from '../../node_modules/@hono/zod-validator';

export const zValidator: (target: any, schema: any, hook?: (result: any, c: any) => any) => any = realZValidator as any;
