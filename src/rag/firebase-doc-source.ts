import admin from "firebase-admin"
import * as path from "path"

import { DocumentSource } from "./document-source"
import { StoredDocument } from "./vector-store"

export interface FirebaseDocConfig {
    collectionPath: string
    textField: string
    metadataFields?: string[]
}

/**
 * Simple Firestore-based document source.
 *
 * Expects a collection where each document has:
 * - a `textField` containing the text to embed
 * - optional metadata fields (listed in `metadataFields`)
 */
export class FirebaseDocSource implements DocumentSource {
    private readonly firestore: admin.firestore.Firestore
    private readonly config: FirebaseDocConfig

    constructor(config: FirebaseDocConfig) {
        if (!admin.apps.length) {
            try {
                // Try to load from service account file
                const serviceAccountPath = path.resolve(
                    __dirname,
                    "../../secret/firebase-service-account.json",
                )

                console.log("Initializing Firebase Admin SDK...")
                console.log("Service account path:", serviceAccountPath)

                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccountPath),
                })

                console.log("✓ Firebase Admin initialized successfully")
            } catch (error) {
                console.error("✗ Failed to initialize Firebase Admin:", error)
                throw error
            }
        }

        this.firestore = admin.firestore()
        this.config = config
    }

    async loadDocuments(): Promise<Omit<StoredDocument, "embedding">[]> {
        const snapshot = await this.firestore.collection(this.config.collectionPath).get()

        const docs: Omit<StoredDocument, "embedding">[] = []

        snapshot.forEach((docSnap: admin.firestore.QueryDocumentSnapshot) => {
            const data = docSnap.data() as Record<string, unknown>
            const text = data[this.config.textField]

            if (typeof text !== "string" || !text.trim()) {
                return
            }

            const metadata: Record<string, unknown> = {}

            for (const field of this.config.metadataFields ?? []) {
                if (field in data) {
                    metadata[field] = data[field]
                }
            }

            docs.push({
                id: docSnap.id,
                text,
                metadata,
            })
        })

        return docs
    }
}
