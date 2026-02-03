### Vibe Code RAG API (NestJS)

**Vibe Code RAG API** is a minimal NestJS-based backend that exposes a simple Retrieval-Augmented Generation (RAG) endpoint.

It uses:
- **NestJS** for the HTTP API structure
- **Gemini** (via `@google/genai`) for embeddings and generation (optional; falls back to a simple local embedding if no key is set)
- An **in-memory vector store** for demo purposes (easy to replace with a real vector DB later)

---

### 1. Prerequisites

- **Node.js** 20+ (required by `@google/genai`)
- **npm** (or `pnpm` / `yarn`, adjust commands accordingly)
- Optional: a **Gemini API key** if you want real embeddings + generated answers

---

### 2. Install dependencies

From the project root (`vibe-code`):

```bash
npm install
```

---

### 3. Environment variables

Create a `.env` file (or otherwise set environment variables) with:

```bash
GEMINI_API_KEY=your_gemini_key_here
# or, alternatively:
# GOOGLE_API_KEY=your_gemini_key_here

# Optional overrides:
# GEMINI_EMBEDDING_MODEL=text-embedding-004
# PORT=3000
```

If `GEMINI_API_KEY` / `GOOGLE_API_KEY` is **not** set:
- The app will still start.
- It will use a deterministic hash-based embedding for both documents and queries.
- **Retrieval will work**, but the `/rag/query` endpoint will **not call Gemini for generation**, and instead will only return the retrieved documents and a descriptive message.

---

### 4. Run the server

For development (with watch mode):

```bash
npm run start:dev
```

Or build & run:

```bash
npm run build
npm start
```

The API will be available at:

```text
http://localhost:3000/api
```

---

### 5. Endpoints

- **Health check**

  ```http
  GET /api/rag/health
  ```

  Response:

  ```json
  { "status": "ok" }
  ```

- **RAG query**

  ```http
  POST /api/rag/query
  Content-Type: application/json

  {
    "query": "What is RAG?",
    "topK": 3,
    "chatModel": "gemini-2.5-flash"
  }
  ```

  - **`query`** (string, required): The user question.
  - **`topK`** (number, optional, default = 3): How many similar documents to retrieve.
  - **`chatModel`** (string, optional): Override the default chat model.

  Example success response (shape will be similar to this):

  ```json
  {
    "answer": "A natural language answer grounded in the retrieved documents...",
    "model": "gemini-2.5-flash",
    "retrievedDocs": [
      {
        "id": "intro-rag",
        "text": "Retrieval-Augmented Generation (RAG) combines information retrieval with text generation models to ground responses in external knowledge.",
        "metadata": {
          "topic": "rag",
          "type": "concept"
        },
        "embedding": [/* numeric vector omitted for brevity */]
      }
    ]
  }
  ```

  If `GEMINI_API_KEY` / `GOOGLE_API_KEY` is **missing**, the response will look more like:

  ```json
  {
    "answer": null,
    "message": "GEMINI_API_KEY (or GOOGLE_API_KEY) is not configured. RAG retrieval works, but generation is disabled. Configure the key to enable full RAG.",
    "retrievedDocs": [ /* ...documents... */ ]
  }
  ```

---

### 6. Project structure

```text
src/
  main.ts          # NestJS bootstrap
  app.module.ts    # Root module
  rag/
    rag.module.ts      # RAG module
    rag.controller.ts  # /rag endpoints
    rag.service.ts     # RAG logic (retrieval + generation)
    vector-store.ts    # Simple in-memory vector store
    dto/
      query.dto.ts     # DTO + validation for RAG queries
```

You can later replace the simple in-memory store with:
- PostgreSQL + pgvector
- Pinecone
- Redis Vector Store
- Any other vector DB

---

### 7. Next steps / customization

- **Add your own documents**: replace the sample documents in `rag.service.ts` with your own corpus, or expose an endpoint to upsert documents into the vector store.
- **Swap vector store**: implement a new service that talks to your production vector DB and call it from `RagService` instead of `InMemoryVectorStore`.
- **Authentication**: add NestJS guards/interceptors to protect the RAG endpoints.
- **Logging/Tracing**: plug in your preferred logger or tracing solution.

