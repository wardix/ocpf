import 'hono';

declare module 'hono' {
  export interface JWTPayload {
    id: number;
    name: string;
    account_id: number;
    role: string;
    email?: string;
    exp?: number;
  }

  interface ContextVariableMap {
    account_id?: number;
    user_id?: number;
    user_role?: string;
    auth_method?: string;
    permissions?: string[];
    jwtPayload?: JWTPayload;
    requestId?: string;
    logger?: any;
  }

  interface HonoRequest {
    valid(target: any): any;
  }
}



declare global {
  interface Response {
    json(): Promise<any>;
  }
}


