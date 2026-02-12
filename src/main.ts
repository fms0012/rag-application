import { NestFactory } from "@nestjs/core"
import { ValidationPipe } from "@nestjs/common"
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger"
import { AppModule } from "./app.module"

async function bootstrap() {
    const app = await NestFactory.create(AppModule)
    app.enableCors()

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true,
            forbidNonWhitelisted: true,
            transform: true,
        }),
    )

    app.setGlobalPrefix("api")

    const config = new DocumentBuilder()
        .setTitle("RAG API")
        .setDescription("The RAG API description")
        .setVersion("1.0")
        .build()
    const document = SwaggerModule.createDocument(app, config)
    SwaggerModule.setup("api", app, document)

    const port = process.env.PORT || 3000
    await app.listen(port)
    // eslint-disable-next-line no-console
    console.log(`RAG API is running on http://localhost:${port}/api`)
}

bootstrap()
