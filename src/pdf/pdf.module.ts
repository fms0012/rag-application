import { Module } from '@nestjs/common';
import { PdfController } from './pdf.controller';
import { PdfService } from './pdf.service';
import { mkdirSync } from 'fs';

// Create upload directory
try {
  mkdirSync('./uploads', { recursive: true });
} catch (error) {}

@Module({
  controllers: [PdfController],
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}
