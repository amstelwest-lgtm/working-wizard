/**
 * UI hooks for source documents. Eng2 calls these. Nothing here posts to a ledger.
 *
 * Upload: put the file in the private `source-docs` bucket at
 * `{client_id}/{object_name}`, then call `register_source_document`.
 * Proposals list: select `ledger_post_proposals` (and the extraction / document
 * tables) filtered by `client_id`.
 * Approve or reject: call `decide_ledger_post_proposal`. The words are
 * approve and reject. There is no sign-off decision.
 */

export const SOURCE_DOCS_BUCKET = "source-docs";
export const SOURCE_DOCS_MAX_BYTES = 20 * 1024 * 1024;
export const SOURCE_RETENTION_YEARS = 5;
export const DEFAULT_FINAL_UNLOCK_AFTER_CLEAN_DRAFTS = 3;

export const sourceDocumentHooks = {
  upload: {
    bucket: SOURCE_DOCS_BUCKET,
    pathPattern: "{client_id}/{object_name}",
    registerRpc: "register_source_document",
    args: ["p_client_id", "p_storage_path", "p_sha256", "p_mime", "p_size_bytes", "p_channel"] as const,
    channels: ["upload", "camera", "email"] as const,
  },
  proposalsList: {
    documentsTable: "source_documents",
    extractionsTable: "document_extractions",
    proposalsTable: "ledger_post_proposals",
    trustTable: "supplier_trust",
    filterColumn: "client_id",
  },
  decide: {
    rpc: "decide_ledger_post_proposal",
    args: ["p_proposal_id", "p_decision", "p_note"] as const,
    decisions: ["approve", "reject"] as const,
  },
  extract: {
    functionName: "extract-source-document",
    body: ["document_id", "target_ledger", "requested_mode"] as const,
  },
} as const;
