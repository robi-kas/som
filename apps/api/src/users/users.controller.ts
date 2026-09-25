import { Controller, Post, Param, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';

@Controller('users')
@UseGuards(AuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @RequirePermissions('user.manage')
  async createUser(@Body() dto: CreateUserDto, @CurrentUser() user: AuthenticatedPrincipal) {
    return this.usersService.createUser(dto, user);
  }

  @Post(':id/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('user.manage')
  async disableUser(@Param('id') id: string, @CurrentUser() user: AuthenticatedPrincipal) {
    return this.usersService.disableUser(id, user);
  }

  @Post(':id/enable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('user.manage')
  async enableUser(@Param('id') id: string, @CurrentUser() user: AuthenticatedPrincipal) {
    return this.usersService.enableUser(id, user);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('user.manage')
  async resetPassword(
    @Param('id') id: string, 
    @Body() dto: ResetPasswordDto,
    @CurrentUser() user: AuthenticatedPrincipal
  ) {
    return this.usersService.resetPassword(id, dto.newPassword, user);
  }

  @Post(':id/revoke-sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('user.manage')
  async revokeSessions(@Param('id') id: string, @CurrentUser() user: AuthenticatedPrincipal) {
    return this.usersService.revokeSessions(id, user);
  }
}
