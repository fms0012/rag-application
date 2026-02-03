import { Module } from "@nestjs/common"
import { RagModule } from "./rag/rag.module"
import { ConfigModule } from "@nestjs/config"

@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
        }),
        RagModule,
    ],
})
export class AppModule {}
