import { StoredDocument } from "./vector-store"

export interface DocumentSource {
    loadDocuments(): Promise<StoredDocument[]>
}
