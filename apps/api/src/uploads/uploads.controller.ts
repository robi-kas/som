import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';

// Only names we generate ourselves (uuid + image extension) are ever served.
// Anything else — including "../" sequences decoded from %2F — is rejected
// before it gets near the filesystem.
const SAFE_IMAGE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|webp)$/i;

export const PRODUCT_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'products');
export const BRANDING_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'branding');
const SAFE_LOGO_NAME = /^logo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|webp)$/i;

@Controller('uploads')
export class UploadsController {
  @Get('products/:filename')
  serveProductImage(@Param('filename') filename: string, @Res() res: Response) {
    if (!SAFE_IMAGE_NAME.test(filename)) {
      throw new NotFoundException('Image not found');
    }

    const filePath = path.resolve(PRODUCT_UPLOAD_DIR, filename);
    if (!filePath.startsWith(PRODUCT_UPLOAD_DIR + path.sep) || !fs.existsSync(filePath)) {
      throw new NotFoundException('Image not found');
    }

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(filePath);
  }

  /** The cafe logo. Public on purpose: it's shown on the sign-in page before anyone logs in. */
  @Get('branding/:filename')
  serveLogo(@Param('filename') filename: string, @Res() res: Response) {
    if (!SAFE_LOGO_NAME.test(filename)) throw new NotFoundException('Image not found');
    const filePath = path.resolve(BRANDING_UPLOAD_DIR, filename);
    if (!filePath.startsWith(BRANDING_UPLOAD_DIR + path.sep) || !fs.existsSync(filePath)) {
      throw new NotFoundException('Image not found');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(filePath);
  }
}
