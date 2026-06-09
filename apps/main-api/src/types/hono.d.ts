import 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    account_id?: number;
    user_id?: number;
    user_role?: string;
    auth_method?: string;
    permissions?: string[];
    jwtPayload?: any;
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


