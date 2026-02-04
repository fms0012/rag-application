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

    async loadDocuments(): Promise<Omit<StoredDocument, "embedding">[]> {
        console.log("Loading documents via Prisma...")

        // Case 1: Dynamic Table / Custom Columns (similar to previous MySQL implementation)
        if (
            this.config.table &&
            this.config.table !== "knowledge_base" &&
            this.config.table !== "RagDocument"
        ) {
            return this.loadFromDynamicTable()
        }

        // Case 2: Use the standard schema model `RagDocument` (mapped to `knowledge_base`)
        return this.loadFromModel()
    }

    private async loadFromModel(): Promise<Omit<StoredDocument, "embedding">[]> {
        try {
            // @ts-ignore - The client is generated dynamically, so RagDocument might not be visible to TS yet if not built
            const rows = await this.client.ragDocument.findMany()

            console.log(rows)

            console.log(`✓ Loaded ${rows.length} documents from Prisma model "RagDocument"`)

            return rows.map((row: any) => ({
                id: row.id,
                text: row.content,
                metadata: (typeof row.metadata === "object" ? row.metadata : {}) || {},
            }))
        } catch (error) {
            console.error("✗ Failed to load from Prisma model RagDocument:", error)
            // Fallback to dynamic if model access fails (e.g. if schema changed but client not regen)
            if (this.config.table) {
                return this.loadFromDynamicTable()
            }
            throw error
        }
    }

    private async loadFromDynamicTable(): Promise<Omit<StoredDocument, "embedding">[]> {
        const table = this.config.table || "knowledge_base"
        const idCol = this.config.idColumn || "id"
        const textCol = this.config.textColumn || "content"
        const metaCols = this.config.metadataColumns || []

        try {
            // Construct query
            const cols = [idCol, textCol, ...metaCols].join(", ")
            const query = `SELECT ${cols} FROM ${table}`

            // Execute raw query
            const rows = (await this.client.$queryRawUnsafe(query)) as any[]

            if (!Array.isArray(rows)) return []

            const docs: Omit<StoredDocument, "embedding">[] = []

            for (const row of rows) {
                const text = row[textCol]
                const id = String(row[idCol])

                if (typeof text !== "string" || !text) continue

                const metadata: Record<string, unknown> = {}
                for (const col of metaCols) {
                    if (col in row) {
                        metadata[col] = row[col]
                    }
                }

                docs.push({ id, text, metadata })
            }

            console.log(
                `✓ Loaded ${docs.length} documents from dynamic table "${table}" via Prisma`,
            )
            return docs
        } catch (error) {
            console.error(`✗ Failed to load documents from table "${table}" via Prisma:`, error)
            throw error
        }
    }
}
