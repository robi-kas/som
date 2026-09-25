import { Controller, Get, Post, Body, HttpCode, HttpStatus, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, SESSION_COOKIE, sessionTtlMs } from './auth.service.js';
import { LoginDto, ChangePasswordDto } from './dto/login.dto.js';
import { AuthGuard } from './guards/auth.guard.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from './interfaces/authenticated-request.interface.js';
import { Throttle } from '@nestjs/throttler';
import type { LoginContext } from './interfaces/login-context.interface.js';
import { cookieIsSecure } from './utils/cookies.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  @UseGuards(AuthGuard)
  getMe(@CurrentUser() user: AuthenticatedPrincipal) {
    return this.authService.getMe(user);
  }

  /**
   * Browsers get the session in an httpOnly cookie (scripts can't read it, so XSS can't steal it).
   * The token is also returned in the body for non-browser clients (print agent, tests, scripts)
   * which send it as `Authorization: Bearer <token>`.
   */
  // Per-IP limit is generous because every device in a cafe shares one public IP;
  // brute force against a single account is stopped by the 5-strike lockout instead.
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  async login(@Body() loginDto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ctx: LoginContext = {
      ipAddress: req.ip || '',
      userAgent: req.headers['user-agent'] || '',
      deviceId: typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'] : undefined,
    };
    const result = await this.authService.login(loginDto, ctx);
    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: cookieIsSecure(),
      sameSite: 'strict',
      path: '/',
      maxAge: sessionTtlMs(),
    });
    return result;
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthenticatedPrincipal) {
    return this.authService.changePassword(dto, user);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  async logout(@CurrentUser() user: AuthenticatedPrincipal, @Res({ passthrough: true }) res: Response) {
    await this.authService.logoutSession(user.sessionId, user.userId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AuthGuard)
  async logoutAll(@CurrentUser() user: AuthenticatedPrincipal, @Res({ passthrough: true }) res: Response) {
    await this.authService.logoutAll(user.userId);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}
