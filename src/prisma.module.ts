// prisma.module.ts
import { Global, Module } from "@nestjs/common"
import { PrismaService } from "./prisma.service"

@Global() // Makes PrismaService available everywhere
@Module({
    providers: [PrismaService],
    exports: [PrismaService],
})
export class PrismaModule {}
