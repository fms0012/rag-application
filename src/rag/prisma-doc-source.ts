import { PrismaClient } from "@prisma/client"
import { DocumentSource } from "./document-source"
import { StoredDocument } from "./vector-store"

export interface PrismaDocConfig {
    client: PrismaClient
    // If not provided, defaults to using the `knowledge_base` model (RagDocument)
    // If provided, uses $queryRawUnsafe to fetch from arbitrary table
    table?: string
    textColumn?: string
    metadataColumns?: string[]
    idColumn?: string
}

export class PrismaDocSource implements DocumentSource {
    private readonly client: PrismaClient
    private readonly config: PrismaDocConfig

    constructor(config: PrismaDocConfig) {
        this.client = config.client
        this.config = config
    }

    async loadDocuments(): Promise<StoredDocument[]> {
        try {
            // @ts-ignore - The client is generated dynamically, so RagDocument might not be visible to TS yet if not built
            const rows = await this.client.ragDocument.findMany()

            console.log(`✓ Loaded ${rows.length} documents from Prisma model "RagDocument"`)

            return rows.map((row: any) => ({
                id: row.id,
                text: row.content,
                metadata: (typeof row.metadata === "object" ? row.metadata : {}) || {},
                embedding: row.embedding,
            }))
        } catch (error) {
            console.error("✗ Failed to load from Prisma model RagDocument:", error)
            // Fallback to dynamic if model access fails (e.g. if schema changed but client not regen)
            throw error
        }
    }
}
