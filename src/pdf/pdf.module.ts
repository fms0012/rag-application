import { Module } from "@nestjs/common"
import { PdfController } from "./pdf.controller"
import { PdfService } from "./pdf.service"
import { mkdirSync } from "fs"
import { RagService } from "src/rag/rag.service"

// Create upload directory
try {
    mkdirSync("./uploads", { recursive: true })
} catch (error) {}

@Module({
    controllers: [PdfController],
    providers: [PdfService, RagService],
    exports: [PdfService],
})
export class PdfModule {}
