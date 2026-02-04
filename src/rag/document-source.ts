import { StoredDocument } from "./vector-store"

export interface DocumentSource {
    loadDocuments(): Promise<Omit<StoredDocument, "embedding">[]>
}
