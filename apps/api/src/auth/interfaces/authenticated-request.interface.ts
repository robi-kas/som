import { Request } from 'express';

export interface AuthenticatedPrincipal {
  userId: string;
  sessionId: string;
  organizationId: string;
  branchIds: string[];
  permissions: string[];
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedPrincipal;
}
