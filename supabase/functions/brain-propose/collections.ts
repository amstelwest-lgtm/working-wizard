/**
 * Edge copy of the collections draft helpers.
 * `src/lib/collections.ts` has no other imports, so this follows that module
 * at bundle time and stays the same implementation the accountant UI uses.
 */
export {
  buildCollectionsDraft,
  chooseCollections,
  collectionsPromptBlock,
  readCollectionsSnapshot,
} from "../../../src/lib/collections.ts";
