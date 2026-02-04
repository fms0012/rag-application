import { Module } from "@nestjs/common"
import { RagModule } from "./rag/rag.module"
import { ConfigModule } from "@nestjs/config"
import { PdfModule } from "./pdf/pdf.module"
import { PrismaModule } from "./prisma.module"

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        RagModule,
        PdfModule,
        PrismaModule,
    ],
})
export class AppModule {}
