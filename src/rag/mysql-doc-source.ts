import { createConnection } from "mysql2/promise"
import { DocumentSource } from "./document-source"
import { StoredDocument } from "./vector-store"

export interface MysqlDocConfig {
    host?: string
    port?: number
    user?: string
    password?: string
    database?: string
    table: string
    textColumn: string
    metadataColumns?: string[]
    idColumn?: string
}

export class MysqlDocSource implements DocumentSource {
    private readonly config: MysqlDocConfig

    constructor(config: MysqlDocConfig) {
        this.config = config
    }

    async loadDocuments(): Promise<Omit<StoredDocument, "embedding">[]> {
        console.log("Connecting to MySQL...")

        const connection = await createConnection({
            host: this.config.host,
            port: this.config.port,
            user: this.config.user,
            password: this.config.password,
            database: this.config.database,
        })

        try {
            const idCol = this.config.idColumn ?? "id"
            // Ensure we select the ID, the text column, and any metadata columns
            const colsToSelect = [
                idCol,
                this.config.textColumn,
                ...(this.config.metadataColumns ?? []),
            ]

            // Basic SQL injection prevention:
            // In a real app, we should validate these column names more strictly
            // or use a query builder, since column names cannot be parameterized directly in SELECT.
            // For this implementation, we assume env vars are trusted.
            const query = `SELECT ${colsToSelect.join(", ")} FROM ${this.config.table}`

            const [rows] = await connection.execute(query)

            if (!Array.isArray(rows)) {
                return []
            }

            const docs: Omit<StoredDocument, "embedding">[] = []

            for (const row of rows as any[]) {
                const text = row[this.config.textColumn]
                const id = String(row[idCol])

                if (typeof text !== "string" || !text) {
                    continue
                }

                const metadata: Record<string, unknown> = {}
                for (const field of this.config.metadataColumns ?? []) {
                    if (field in row) {
                        metadata[field] = row[field]
                    }
                }

                docs.push({
                    id,
                    text,
                    metadata,
                })
            }

            console.log(`✓ Loaded ${docs.length} documents from MySQL table "${this.config.table}"`)
            return docs
        } catch (error) {
            console.error("✗ Failed to load documents from MySQL:", error)
            throw error
        } finally {
            await connection.end()
        }
    }
}
