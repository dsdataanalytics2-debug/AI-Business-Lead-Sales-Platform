import { Request, Response, NextFunction } from 'express';
import {
  Role,
  teamMemberListQuerySchema,
  teamMemberUserIdParamSchema,
  createTeamMemberRequestSchema,
  updateTeamMemberRequestSchema
} from '@leadmate/shared';
import { teamService, TeamActorContext } from '../services/team.service.js';

function getActorContext(req: Request): TeamActorContext {
  return {
    actorId: req.user!.id,
    organizationId: req.user!.organizationId,
    role: req.user!.role as unknown as Role
  };
}

export class TeamController {
  async listMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = teamMemberListQuerySchema.parse(req.query);
      const actor = getActorContext(req);
      const result = await teamService.listMembers(actor, query);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async getMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = teamMemberUserIdParamSchema.parse(req.params);
      const actor = getActorContext(req);
      const result = await teamService.getMemberDetail(actor, userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async createMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = createTeamMemberRequestSchema.parse(req.body);
      const actor = getActorContext(req);
      const result = await teamService.createMember(actor, input);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  }

  async updateMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = teamMemberUserIdParamSchema.parse(req.params);
      const input = updateTeamMemberRequestSchema.parse(req.body);
      const actor = getActorContext(req);
      const result = await teamService.updateMember(actor, userId, input);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async activateMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = teamMemberUserIdParamSchema.parse(req.params);
      const actor = getActorContext(req);
      const result = await teamService.activateMember(actor, userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }

  async deactivateMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { userId } = teamMemberUserIdParamSchema.parse(req.params);
      const actor = getActorContext(req);
      const result = await teamService.deactivateMember(actor, userId);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}

export const teamController = new TeamController();
